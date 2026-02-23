# MTA ML Data Laboratory -- Implementation Plan

_Last Updated: 2026-02-23_

---

## Phase Overview

| Phase | Name | Description | Depends On | Risk |
|-------|------|-------------|------------|------|
| 0 | Documentation | Context, plan, and task docs | None | Green |
| 1 | Real-Time Data Capture | Position archiver + analysis persistence | None | Yellow |
| 2 | Historical Data Upload | CSV cleaning + Parquet conversion + S3 upload | None | Green |
| 3 | CDK ML Lab Stack | SageMaker + Glue tables + IAM + ML bucket | Phase 1 (S3 client pattern), Phase 2 (S3 prefixes) | Yellow |
| 4 | ML Dataset Pipeline | Glue ETL job assembling 5 ML datasets | Phase 3 (Glue tables exist) | Yellow |
| 5 | Jupyter Notebooks | 3 notebooks for ridership, reliability, delay | Phase 2 (historical data), Phase 4 (datasets) | Green |

### Execution Order

```
Phase 0 (docs)
  |
  +---> Phase 1 (server: position archiver + analysis persistence)
  |         |
  +---> Phase 2 (script: upload historical CSVs to S3)
  |         |
  +---> Phase 5 (notebooks: can start structure, finalize after Phase 4)
  |
  v
Phase 3 (CDK: ML Lab stack -- needs to know S3 key patterns from Phase 1+2)
  |
  v
Phase 4 (Glue: ML dataset pipeline -- needs Glue tables from Phase 3)
  |
  v
Phase 5 (notebooks: finalize with real data paths from Phase 4)
```

Phases 1, 2, and 5 (notebook scaffolding) can run **in parallel** after Phase 0 completes. Phase 3 depends on Phase 1 and 2 being at least designed (S3 key patterns finalized). Phase 4 depends on Phase 3. Phase 5 finalization depends on Phase 4.

---

## Phase 0: Documentation

**Status:** In Progress
**Risk:** Green -- no code changes, no blast radius

### Deliverables

| File | Purpose |
|------|---------|
| `dev/active/ml-lab/ml-lab-context.md` | Comprehensive context: architecture, datasets, costs, risks |
| `dev/active/ml-lab/ml-lab-plan.md` | This file -- phased implementation plan |
| `dev/active/ml-lab/ml-lab-tasks.md` | Granular task checklist with dependencies |
| `dev/active/handoff-notes.md` | New session entry at top |

### Completion Criteria

- All 3 ml-lab docs written with full detail
- Handoff notes updated with ML Lab session entry
- No code changes

---

## Phase 1: Real-Time Data Capture

**Status:** Not Started
**Risk:** Yellow -- touches server/src/index.ts (high blast radius) and feed-loop integration
**Estimated effort:** 4-6 tasks

### Files

| File | Action | Description |
|------|--------|-------------|
| `server/src/lib/s3.ts` | Create | S3 client singleton (follows `dynamodb.ts` pattern) |
| `server/src/analytics/position-archiver.ts` | Create | Buffered position writer: accumulates positions, flushes to S3 every 5 min |
| `server/src/api/transit-analysis.ts` | Modify | Add DynamoDB write for ANALYSIS# records after Bedrock response |
| `server/src/index.ts` | Modify | Wire position-archiver into feed loop callback + shutdown handler |
| `server/package.json` | Modify | Add `@aws-sdk/client-s3` dependency |
| `server/src/types/` | Modify (if needed) | Add PositionArchive type if not covered by existing types |

### Key Decisions

- **Flush interval: 5 minutes.** Balances S3 PUT costs ($0.005/1K PUTs) against data freshness. At 5-min intervals, that is 288 PUTs/day = ~$0.04/month.
- **NDJSON over Parquet for positions.** Raw positions are append-only, write-heavy, read-rarely. NDJSON + gzip is simpler to produce from Node.js than Parquet (which requires pyarrow or a native binding). Glue/Athena can query NDJSON directly.
- **Buffer cap: 10K records.** Safety valve. If the feed loop produces more than expected (feed bursts, duplicate events), the archiver drops the oldest records and logs a warning rather than consuming unbounded memory.

### Dependencies

- AWS SDK S3 client must be installed
- S3 bucket must exist (created by AnalyticsStack, but ML Lab may need its own prefix or bucket)
- IAM: EC2 instance role needs `s3:PutObject` on the target bucket/prefix

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Archiver error crashes feed loop | High | Wrap archiver calls in try/catch in feed-loop. Archiver failures must not propagate. |
| Memory growth from buffer | Medium | Hard cap at 10K records + forced flush. Log warning on cap hit. |
| S3 write latency slows shutdown | Low | Shutdown flush has 10s timeout. If exceeded, log warning and exit. |

---

## Phase 2: Historical Data Upload

**Status:** Not Started
**Risk:** Green -- standalone script, no production code changes
**Estimated effort:** 3-4 tasks

### Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/upload-historical-mta.ts` | Create | Read CSVs, clean, convert to Parquet, upload to S3 |

### Processing Steps Per CSV

1. Read CSV from local filesystem (`C:\Users\User\Downloads\mtaData\`)
2. Parse with csv-parser or papaparse
3. Normalize column names (lowercase, underscores, no spaces)
4. Normalize dates (ISO 8601: YYYY-MM-DD or YYYY-MM)
5. Validate schema (expected columns present, no all-null rows)
6. Convert to Parquet using `parquet-wasm` or write as NDJSON (Parquet preferred for Athena performance)
7. Upload to S3 at `historical/{dataset_name}/data.parquet`
8. Log row counts and S3 keys

### S3 Key Mapping

| CSV File | S3 Key |
|----------|--------|
| `MTA_Daily_Ridership_and_Traffic__Beginning_2020_20260223.csv` | `historical/daily_ridership/data.parquet` |
| `MTA_Subway_Terminal_On-Time_Performance__2015-2019_20260223.csv` | `historical/terminal_otp/data.parquet` |
| `MTA_Subway_Major_Incidents__2015-2019_20260223.csv` | `historical/major_incidents/data.parquet` |
| `MTA_NYCT_Subway_Fare_Evasion__Beginning_2018_20260223.csv` | `historical/fare_evasion/data.parquet` |
| `MTA_Subway_Mean_Distance_Between_Failures__Beginning_2015_20260223.csv` | `historical/mdbf/data.parquet` |
| `MTA_Subway_Customer_Journey-Focused_Metrics__2015-2019_20260223.csv` | `historical/customer_journey/data.parquet` |
| `MTA_Subway_Service_Delivered__2015-2019_20260223.csv` | `historical/service_delivered/data.parquet` |

### Dependencies

- Node.js CSV parsing library (papaparse or csv-parser)
- Parquet writing library (parquet-wasm, @dsnp/parquetjs, or fallback to NDJSON)
- AWS credentials with `s3:PutObject` permission
- Target S3 bucket name (from AnalyticsStack or new ML bucket)

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| CSV encoding issues | Low | MTA CSVs are UTF-8. Script validates encoding on read. |
| Parquet library compatibility | Medium | If parquet-wasm fails on Windows/Node, fallback to NDJSON upload. Athena handles both. |
| Large CSV memory usage | Low | 16K rows * ~200 bytes = ~3MB. No streaming needed. |

---

## Phase 3: CDK ML Lab Stack

**Status:** Not Started
**Risk:** Yellow -- CDK changes affect AWS infrastructure; wrong IAM can expose data or incur costs
**Estimated effort:** 5-7 tasks

### Files

| File | Action | Description |
|------|--------|-------------|
| `infra/cdk/lib/ml-lab-stack.ts` | Create | Full ML Lab stack: SageMaker, ML bucket, Glue tables, ETL job, IAM |
| `infra/cdk/lib/analytics-stack.ts` | Modify | Export bucket ARN, Glue DB name, DynamoDB table ARN for cross-stack refs |
| `infra/cdk/bin/app.ts` | Modify | Instantiate MlLabStack with cross-stack dependencies |
| `infra/cdk/lambda/ml-dataset-trigger/index.ts` | Create | EventBridge handler that starts the Glue ML dataset job |

### Stack Resources

```
MlLabStack
  ├── S3 Bucket: railtime-ml-artifacts-{account}
  │     ├── Lifecycle: Glacier after 90 days (training outputs)
  │     └── Encryption: S3-managed
  │
  ├── Glue Tables (7 historical + 1 real-time positions)
  │     ├── historical_daily_ridership
  │     ├── historical_terminal_otp
  │     ├── historical_major_incidents
  │     ├── historical_fare_evasion
  │     ├── historical_mdbf
  │     ├── historical_customer_journey
  │     ├── historical_service_delivered
  │     └── raw_positions (partitioned by year/month/day/hour)
  │
  ├── Glue ETL Job: ml-dataset-pipeline
  │     ├── Script: s3://{ml-bucket}/glue-scripts/ml-dataset-pipeline.py
  │     ├── Worker type: G.1X (standard)
  │     ├── Max workers: 2
  │     └── Timeout: 30 minutes
  │
  ├── SageMaker Notebook Instance
  │     ├── Instance type: ml.t3.medium
  │     ├── Volume: 20 GB
  │     ├── Lifecycle config: auto-stop after 1 hour idle
  │     └── Default code repository: (optional, can clone from S3)
  │
  ├── SageMaker Execution Role (IAM)
  │     ├── S3 read on analytics bucket
  │     ├── S3 read/write on ML artifacts bucket
  │     ├── Athena query execution
  │     ├── Glue catalog read
  │     ├── DynamoDB read on analytics table
  │     └── CloudWatch Logs write
  │
  ├── EventBridge Rule: daily at 06:00 UTC
  │     └── Target: ml-dataset-trigger Lambda
  │
  └── Lambda: ml-dataset-trigger
        ├── Starts Glue ETL job
        └── IAM: glue:StartJobRun
```

### Cross-Stack Dependencies

```typescript
// analytics-stack.ts exports:
this.analyticsBucket       // S3 bucket (real-time data + historical uploads)
this.glueDatabase          // Glue database name
this.dynamoTable           // DynamoDB table ARN

// ml-lab-stack.ts imports via constructor props:
interface MlLabStackProps extends cdk.StackProps {
  analyticsBucket: s3.IBucket;
  glueDatabaseName: string;
  dynamoTableArn: string;
}
```

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| SageMaker cost overrun | Medium | Lifecycle auto-stop config. CloudWatch billing alarm at $20/month. |
| IAM over-permission | Medium | Least-privilege: no s3:DeleteObject, no dynamodb:PutItem, no admin access. Review in code review phase. |
| Glue job timeout | Low | 30-min timeout is generous for <30K rows. Alert on failure via existing SNS topic. |
| CDK deploy breaks analytics | High | Separate stack. AnalyticsStack changes are export-only (additive). Test with `cdk diff` before deploy. |

---

## Phase 4: ML Dataset Pipeline

**Status:** Not Started
**Risk:** Yellow -- PySpark job; errors are hard to debug locally
**Estimated effort:** 3-4 tasks

### Files

| File | Action | Description |
|------|--------|-------------|
| `infra/cdk/glue-scripts/ml-dataset-pipeline.py` | Create | PySpark ETL job producing 5 dataset families |

### Job Logic

```python
# Pseudocode
def main():
    spark = create_spark_session()
    glue_context = create_glue_context(spark)

    # 1. Ridership Forecast Dataset
    ridership = read_table("historical_daily_ridership")
    ridership = add_lag_features(ridership, [1, 7, 28])
    ridership = add_calendar_features(ridership)  # day-of-week, month, holiday
    write_dataset(ridership, "ridership_forecast")

    # 2. Reliability Analysis Dataset
    mdbf = read_table("historical_mdbf")
    incidents = read_table("historical_major_incidents")
    service = read_table("historical_service_delivered")
    reliability = join_on_month_division(mdbf, incidents, service)
    reliability = add_derived_features(reliability)  # incident rate, delivery ratio
    write_dataset(reliability, "reliability_analysis")

    # 3. Delay Prediction Dataset (requires real-time data)
    if table_exists("raw_positions") and row_count("raw_positions") > 1000:
        positions = read_table("raw_positions")
        otp = read_table("historical_terminal_otp")
        delays = compute_delay_buckets(positions)  # on-time / minor / major
        delays = join_historical_otp(delays, otp)
        delays = add_temporal_features(delays)
        write_dataset(delays, "delay_prediction")

    # 4. Anomaly Detection Dataset (requires real-time data)
    if has_sufficient_data("raw_positions", min_days=3):
        # ... speed variance, headway deviation features
        write_dataset(anomalies, "anomaly_detection")

    # 5. Position Trajectory Dataset (requires raw positions)
    if has_sufficient_data("raw_positions", min_days=1):
        # ... lat/lon sequences, speed profiles
        write_dataset(trajectories, "position_trajectory")
```

### Output Location

All datasets written to: `s3://{ml-artifacts-bucket}/datasets/{dataset_name}/data.parquet`

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| PySpark local testing | Medium | Test with small sample data locally using `pyspark` before uploading to Glue. |
| Schema drift in source tables | Low | Explicit column selection in reads. Fail with clear error if expected columns missing. |
| Empty real-time tables (early days) | Expected | Conditional logic: skip datasets that need real-time data if tables are empty. Log skip reason. |

---

## Phase 5: Jupyter Notebooks

**Status:** Not Started
**Risk:** Green -- notebooks are documentation + analysis code, no production impact
**Estimated effort:** 3-4 tasks

### Files

| File | Action | Description |
|------|--------|-------------|
| `notebooks/01-ridership-forecasting.ipynb` | Create | Prophet + XGBoost ridership prediction |
| `notebooks/02-reliability-mdbf-analysis.ipynb` | Create | Random Forest reliability analysis |
| `notebooks/03-delay-prediction.ipynb` | Create | XGBoost delay classification |

### Notebook Structure (all 3 follow this pattern)

```
Cell 1: Title + description (markdown)
Cell 2: Imports + configuration
Cell 3: Data loading (Athena SQL or S3 direct)
Cell 4: Exploratory data analysis (stats + plots)
Cell 5: Feature engineering
Cell 6: Model training (baseline)
Cell 7: Model training (primary)
Cell 8: Evaluation + comparison
Cell 9: Save artifacts to S3
Cell 10: Summary + next steps (markdown)
```

### Library Dependencies

Notebooks assume SageMaker's pre-installed conda environment (`conda_python3`) which includes:
- pandas, numpy, matplotlib, seaborn (pre-installed)
- scikit-learn (pre-installed)
- boto3 (pre-installed)

Additional installs needed in notebook cell:
```python
!pip install prophet xgboost pyathena
```

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Prophet install fails on SageMaker | Low | Prophet is pip-installable on SageMaker conda_python3. Fallback: use statsmodels ARIMA. |
| Notebooks reference wrong S3 paths | Low | Parameterize bucket names in first cell. Load from env or SSM. |
| Notebook 03 runs before 3 days of data | Expected | Guard cell: check row count, print warning and exit early if insufficient data. |

---

## Verification Plan

After each phase, verify:

| Phase | Verification |
|-------|-------------|
| 0 | Docs written, handoff notes updated |
| 1 | `cd server && npx tsc --noEmit` passes. Position archiver unit test. Manual test: start server, check S3 for position files after 5 min. |
| 2 | Run upload script. Verify 7 Parquet files in S3 with correct row counts. |
| 3 | `cd infra/cdk && npx tsc --noEmit` passes. `cdk diff` shows expected resources. `cdk deploy MlLabStack` succeeds. SageMaker notebook accessible in console. |
| 4 | Trigger Glue job manually. Verify dataset Parquet files in ML artifacts bucket. |
| 5 | Open notebook in SageMaker. Run all cells. No errors. Model artifacts saved to S3. |

---

## Links

- Context: `dev/active/ml-lab/ml-lab-context.md`
- Tasks: `dev/active/ml-lab/ml-lab-tasks.md`
- Handoff: `dev/active/handoff-notes.md`
