# MTA ML Data Laboratory -- Context

_Last Updated: 2026-02-23_

---

## Project Context

Railtime's WS server (`server/`) is the highest-frequency producer of NYC subway operational data available outside the MTA itself. Every 15 seconds, the feed loop ingests GTFS-RT protobuf feeds for all 8 feed groups, computes interpolated train positions, calculates delays against scheduled times, derives headway distributions, flags anomalies, and (via Bedrock Nova Micro) generates natural-language transit analysis summaries.

Two of the most analytically valuable streams -- **raw interpolated positions** and **AI transit analysis** -- are currently cached in Redis with TTLs of 30-600 seconds and then discarded. No historical record survives beyond the cache window. This represents a significant data loss for any ML or analytics use case that requires time-series depth.

Additionally, the MTA publishes historical performance datasets as open CSV files. Seven of these have been downloaded to `C:\Users\User\Downloads\mtaData\` and collectively span 2015-2026, covering ridership, on-time performance, mechanical reliability, service delivery, customer journey metrics, major incidents, and fare evasion. Together these datasets total approximately 29,000 rows and provide the historical baseline that real-time data alone cannot.

The ML Data Laboratory feature bridges these two worlds: it captures real-time streams to durable storage (S3 + DynamoDB), ingests historical CSVs into a queryable data lake, provisions a SageMaker notebook environment, and delivers Jupyter notebooks that train models across both datasets.

---

## Historical Dataset Inventory

All CSV files are located at `C:\Users\User\Downloads\mtaData\`.

| CSV File | S3 Prefix | Rows | Key Columns |
|----------|-----------|------|-------------|
| `MTA_Daily_Ridership_and_Traffic__Beginning_2020_20260223.csv` | `historical/daily_ridership/` | ~16K | date, subway ridership, bus ridership, LIRR, MNR, bridges/tunnels |
| `MTA_Subway_Terminal_On-Time_Performance__2015-2019_20260223.csv` | `historical/terminal_otp/` | ~1.6K | month, division, line, on-time % |
| `MTA_Subway_Major_Incidents__2015-2019_20260223.csv` | `historical/major_incidents/` | ~2.9K | month, category, division, line, incident count |
| `MTA_NYCT_Subway_Fare_Evasion__Beginning_2018_20260223.csv` | `historical/fare_evasion/` | ~33 | quarter, estimates |
| `MTA_Subway_Mean_Distance_Between_Failures__Beginning_2015_20260223.csv` | `historical/mdbf/` | ~1.75K | month, car class, division, MDBF value |
| `MTA_Subway_Customer_Journey-Focused_Metrics__2015-2019_20260223.csv` | `historical/customer_journey/` | ~2K | month, metrics, division |
| `MTA_Subway_Service_Delivered__2015-2019_20260223.csv` | `historical/service_delivered/` | ~2.7K | month, line, % delivered |

### Notes on Historical Data

- **Daily Ridership** is by far the largest dataset (~16K rows) and the most recent (through 2026). It covers all MTA modes, not just subway.
- **OTP, Incidents, MDBF, Customer Journey, Service Delivered** all share the 2015-2019 window. They can be joined on month + division/line for multi-dimensional reliability analysis.
- **Fare Evasion** is the smallest dataset (~33 rows) and only useful as a supplementary feature, not a standalone ML target.
- All files use MTA's standard date formats (MM/DD/YYYY or YYYY-MM for monthly aggregates). The upload script must normalize these.

---

## Architecture

### Current State (before ML Lab)

```
MTA GTFS-RT (protobuf)
  --> server/src/ingestion/feed-loop.ts
    --> Redis cache (30s TTL) --> Socket.IO broadcast --> Browser
    --> metrics-collector --> DynamoDB (SYSTEM_HEALTH, FEED_STATUS, TRIP_START/END)
                                --> DynamoDB Streams --> stream-to-s3 Lambda --> S3 NDJSON

server/src/api/transit-analysis.ts
  --> Bedrock Nova Micro --> Redis cache (600s TTL) --> HTTP response
  --> (NOT persisted to DynamoDB or S3)
```

### Target State (with ML Lab)

```
Historical CSVs
  --> scripts/upload-historical-mta.ts
    --> Clean, normalize, convert to Parquet
    --> Upload to S3 (historical/{dataset_name}/)
    --> Glue crawler registers tables

Real-Time Positions (NEW capture):
  feed-loop.ts
    --> position-archiver.ts (new)
      --> Buffer 15s snapshots in memory
      --> Every 5 minutes: gzip + write to S3 (raw/positions/YYYY/MM/DD/HH/mm.ndjson.gz)

AI Transit Analysis (NEW capture):
  transit-analysis.ts
    --> DynamoDB (ANALYSIS#timestamp records, new PK pattern)
    --> Existing DynamoDB Streams --> stream-to-s3 Lambda --> S3 (events/analysis/)

ML Lab:
  SageMaker notebook (ml.t3.medium, auto-stop 1hr)
    --> Reads all data via:
      - Athena (SQL over historical Parquet + real-time NDJSON)
      - S3 direct (raw position files)
      - DynamoDB direct (recent analysis records)
    --> Trains models, writes artifacts to ml-artifacts bucket
```

### Data Flow Diagram

```
+-------------------+     +------------------+     +-------------------+
|  7 MTA CSV Files  |---->| upload-historical |---->| S3: historical/   |
| (local downloads) |     | -mta.ts (script) |     | (Parquet)         |
+-------------------+     +------------------+     +-------------------+
                                                           |
                                                           v
+-------------------+     +------------------+     +-------------------+
| MTA GTFS-RT       |---->| feed-loop.ts     |---->| position-archiver |
| (protobuf feeds)  |     | (existing)       |     | (NEW, S3 gzip)    |
+-------------------+     +------------------+     +-------------------+
                                |                          |
                                v                          v
                          +------------------+     +-------------------+
                          | metrics-collector|     | S3: raw/positions/|
                          | (existing)       |     | (NDJSON.gz)       |
                          +------------------+     +-------------------+
                                |                          |
                                v                          v
                          +------------------+     +-------------------+
                          | DynamoDB         |     | Glue Crawler      |
                          | (events table)   |     | (registers tables)|
                          +------------------+     +-------------------+
                                |                          |
                                v                          v
                          +------------------+     +-------------------+
                          | stream-to-s3     |     | Athena            |
                          | Lambda (existing)|     | (SQL queries)     |
                          +------------------+     +-------------------+
                                |                          |
                                v                          v
                          +------------------+     +-------------------+
                          | S3: events/      |     | SageMaker         |
                          | (NDJSON)         |     | Notebook          |
                          +------------------+     +-------------------+
                                                           |
                                                           v
                                                   +-------------------+
                                                   | ML Artifacts      |
                                                   | Bucket (models,   |
                                                   | reports, plots)   |
                                                   +-------------------+
```

---

## CDK Stack Design

### Separation of Concerns

The ML Lab gets its own CDK stack (`MlLabStack`) separate from the existing `AnalyticsStack`. This keeps blast radius contained -- deploying ML infrastructure changes cannot accidentally affect the production analytics pipeline.

**AnalyticsStack exports consumed by MlLabStack:**
- Analytics S3 bucket ARN (for Glue/Athena to read real-time data)
- Analytics S3 bucket lifecycle rules (extended for ML retention)
- Glue database name (shared catalog)
- DynamoDB table ARN (for SageMaker read access)

**MlLabStack provisions:**
- ML artifacts S3 bucket (model checkpoints, training outputs, plots)
- 7 Glue tables for historical datasets (one per CSV family)
- 1 Glue table for raw position data
- SageMaker notebook instance (ml.t3.medium, auto-stop after 1 hour)
- SageMaker execution IAM role (S3 read/write, Athena query, Glue catalog, DynamoDB read)
- Glue ML dataset ETL job (PySpark)
- EventBridge rule + Lambda trigger for scheduled dataset refresh

### SageMaker Notebook Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Instance type | `ml.t3.medium` | 2 vCPU, 4GB RAM -- sufficient for tabular ML on ~30K-row datasets. Cheapest option that can run Prophet + XGBoost. |
| Auto-stop | 1 hour idle | Prevents runaway costs from forgotten notebooks. |
| Volume size | 20 GB | Enough for datasets + model artifacts. Historical data is ~5MB, position data grows ~50MB/day. |
| Lifecycle config | Auto-stop script | CloudWatch-based idle detection, stops instance after 3600s of no kernel activity. |

### IAM Role: SageMaker Execution

```
Permissions:
  - s3:GetObject, s3:ListBucket on analytics bucket (read real-time + historical data)
  - s3:GetObject, s3:PutObject, s3:ListBucket on ML artifacts bucket (read/write models)
  - athena:StartQueryExecution, athena:GetQueryResults (SQL over Glue tables)
  - glue:GetTable, glue:GetDatabase, glue:GetPartitions (catalog access)
  - dynamodb:Query, dynamodb:Scan on analytics table (read recent events)
  - logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents (notebook logs)
```

---

## Cost Estimate

| Resource | Monthly Cost | Notes |
|----------|-------------|-------|
| SageMaker ml.t3.medium | ~$5.00 | ~120 hrs/month at $0.042/hr (with auto-stop, likely less) |
| S3 storage (historical) | ~$0.01 | ~5MB Parquet, negligible |
| S3 storage (positions) | ~$1.50 | ~50MB/day * 30 days = 1.5GB at $0.023/GB |
| S3 storage (ML artifacts) | ~$0.10 | Model files, plots, reports |
| Glue crawler | ~$0.50 | On-demand runs, ~5 min each |
| Glue ETL job | ~$2.00 | PySpark DPU-hours for dataset assembly |
| Athena queries | ~$0.50 | Pay-per-query, small datasets |
| EventBridge + Lambda | ~$0.00 | Free tier |
| DynamoDB reads | ~$0.00 | Existing table, read capacity already provisioned |
| **Total** | **~$10-14/month** | Conservative estimate with auto-stop discipline |

---

## ML Dataset Pipeline

The Glue ETL job (`ml-dataset-pipeline.py`) reads from all data sources and produces 5 ML-ready dataset families in the ML artifacts bucket.

### Dataset Families

| Dataset | Sources | Target Variable | Features | Timeline |
|---------|---------|-----------------|----------|----------|
| `ridership_forecast` | daily_ridership CSV, day-of-week, holidays | next-day subway ridership | lagged ridership (1d, 7d, 28d), day-of-week, month, COVID flag, weather (future) | Day 1 |
| `reliability_analysis` | mdbf, service_delivered, major_incidents | MDBF value | car class, division, incident rate, service delivery %, season | Day 1 |
| `delay_prediction` | real-time positions (3+ days), OTP, service_delivered | delay bucket (on-time / minor / major) | route, time-of-day, day-of-week, headway, historical OTP, recent incident count | 3+ days |
| `anomaly_detection` | real-time positions (3+ days), system_health events | anomaly label | speed variance, headway deviation, feed staleness, alert count | 3+ days |
| `position_trajectory` | raw positions (1+ days) | cluster ID | lat/lon sequences, route, time-of-day, speed profile | 1+ days |

### Why These Timelines

- **Day 1 datasets** (ridership_forecast, reliability_analysis) use only historical CSV data. No real-time collection dependency.
- **3+ day datasets** (delay_prediction, anomaly_detection) require accumulated real-time position and event data. Three days gives enough variance for initial model training (~17K position snapshots, ~300 system health records).
- **1+ day datasets** (position_trajectory) need raw position archives. One day gives ~96 five-minute batches (~5,760 position records per route).

---

## Jupyter Notebooks

### 01 -- Ridership Forecasting

**File:** `notebooks/01-ridership-forecasting.ipynb`
**Models:** Prophet (baseline) + XGBoost (gradient-boosted)
**Data:** `ridership_forecast` dataset (~16K rows)
**Goal:** Predict next-day NYC subway ridership given historical patterns, day-of-week, and seasonal effects.

Key sections:
1. Load data from Athena (SQL) or S3 direct
2. Exploratory analysis: ridership trends, COVID impact, weekday/weekend patterns
3. Prophet model: automatic seasonality detection, holiday effects
4. XGBoost model: feature engineering (lags, rolling means, day encoding)
5. Model comparison: MAE, MAPE, residual plots
6. Save best model artifact to S3

### 02 -- Reliability & MDBF Analysis

**File:** `notebooks/02-reliability-mdbf-analysis.ipynb`
**Models:** Random Forest (feature importance) + Linear Regression (baseline)
**Data:** `reliability_analysis` dataset (joined MDBF + incidents + service delivery, ~1.75K rows)
**Goal:** Identify which factors most strongly predict mechanical reliability (MDBF) across car classes and divisions.

Key sections:
1. Load and join MDBF, incidents, service delivery data
2. Exploratory analysis: MDBF trends by car class, division correlations
3. Feature engineering: incident rate, service delivery ratio, seasonal encoding
4. Random Forest: feature importance ranking, partial dependence plots
5. Linear regression baseline for interpretability
6. Report: top predictors of reliability, actionable insights

### 03 -- Delay Prediction

**File:** `notebooks/03-delay-prediction.ipynb`
**Models:** XGBoost classifier (multi-class: on-time / minor / major delay)
**Data:** `delay_prediction` dataset (requires 3+ days of real-time data)
**Goal:** Predict whether a given train on a given route at a given time will be on-time, slightly delayed, or significantly delayed.

Key sections:
1. Load real-time position data + historical OTP baselines
2. Define delay buckets: on-time (<2 min), minor (2-5 min), major (>5 min)
3. Feature engineering: route, hour, day-of-week, recent headway, historical OTP for route/time
4. XGBoost multi-class classifier with class weight balancing
5. Evaluation: confusion matrix, per-class precision/recall, feature importance
6. Save model + inference function for potential real-time scoring

### Future Notebooks (not in initial scope)

- **04 -- Anomaly Detection**: Isolation Forest / autoencoder on position + system health streams
- **05 -- Trajectory Clustering**: DBSCAN / DTW on raw position sequences per route
- **06 -- Customer Journey Analysis**: Regression on customer journey metrics vs. service factors
- **07 -- Neural Delay Predictor**: LSTM/Transformer on position time series (requires weeks of data)

---

## Server-Side Changes

### position-archiver.ts (new)

Follows the same pattern as `metrics-collector.ts`: receives data from the feed loop, buffers in memory, periodically flushes to storage.

```
Interface:
  - archivePositions(feedGroup: string, positions: TrainPosition[]) -- called by feed-loop after each poll
  - flush() -- writes buffered data to S3, called every 5 minutes
  - shutdown() -- final flush + cleanup, called on SIGTERM/SIGINT

S3 key pattern: raw/positions/{YYYY}/{MM}/{DD}/{HH}/{mm}.ndjson.gz
  - One file per 5-minute window
  - NDJSON format (one JSON object per line per train position)
  - Gzipped for storage efficiency (~10:1 compression on JSON)

Buffer strategy:
  - In-memory array, appended every 15s (feed loop interval)
  - ~20 positions per feed group * 8 groups * 20 polls per 5min = ~3,200 records per flush
  - At ~200 bytes per record compressed, each file is ~640 bytes. Negligible memory and S3 cost.
```

### transit-analyzer changes

The existing `transit-analysis.ts` endpoint queries DynamoDB for recent metrics and sends them to Bedrock for analysis. Currently, the analysis response is cached in Redis but not persisted.

Change: after receiving the Bedrock response, write an `ANALYSIS#<timestamp>` record to DynamoDB. The existing DynamoDB Streams + stream-to-s3 Lambda pipeline automatically archives it to S3. No new infrastructure needed for this stream.

### S3 Client Singleton

New file `server/src/lib/s3.ts` following the pattern of `server/src/lib/dynamodb.ts`:
- Lazy-initialized S3Client
- Region from `AWS_REGION` env var
- Exports `getS3Client()` and `shutdownS3()`

---

## Integration Points

| System | Integration | Direction |
|--------|-------------|-----------|
| feed-loop.ts | Calls `archivePositions()` after each poll | Server --> S3 |
| transit-analysis.ts | Writes ANALYSIS# records to DynamoDB | Server --> DynamoDB |
| DynamoDB Streams | Existing pipeline archives to S3 | DynamoDB --> S3 |
| Glue Crawler | Discovers new S3 partitions | S3 --> Glue Catalog |
| Athena | Queries Glue tables | Glue Catalog --> Query Results |
| SageMaker | Reads from S3/Athena, writes to ML bucket | All directions |
| upload-historical-mta.ts | One-time script, reads CSVs, writes Parquet to S3 | Local --> S3 |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SageMaker left running | Cost overrun ($30/month if 24/7) | Auto-stop lifecycle config (1hr idle), CloudWatch billing alarm |
| Position archiver memory leak | Server OOM | Fixed 5-min flush interval, buffer size cap (10K records max) |
| Glue job failure on malformed data | Missing ML datasets | Input validation in PySpark, DLQ pattern, alerting |
| Historical CSV format changes | Upload script fails | Schema validation in upload script, fail-fast with clear errors |
| S3 costs grow with position data | ~$1.50/month/30 days | S3 lifecycle policy: move to Glacier after 90 days, delete after 365 |
| DynamoDB read capacity for SageMaker | Throttling | Use Athena (reads from S3 archives) for bulk queries, DynamoDB only for recent data |

---

## Links

- Historical MTA datasets: `C:\Users\User\Downloads\mtaData\`
- Existing analytics stack: `infra/cdk/lib/analytics-stack.ts`
- Existing metrics collector: `server/src/analytics/metrics-collector.ts`
- Existing transit analysis: `server/src/api/transit-analysis.ts`
- Existing DynamoDB client: `server/src/lib/dynamodb.ts`
- Existing stream-to-s3 Lambda: `infra/cdk/lambda/stream-to-s3/`
- Dev plan: `dev/active/ml-lab/ml-lab-plan.md`
- Task tracker: `dev/active/ml-lab/ml-lab-tasks.md`
