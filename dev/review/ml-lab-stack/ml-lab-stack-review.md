Last Updated: 2026-02-23

# ml-lab-stack — Code Review

## Executive Summary

This review covers the ML Data Laboratory feature spanning 10 source files and 3 notebooks: the CDK infrastructure stack (`ml-lab-stack.ts`, 520 lines), modifications to the existing analytics stack, a SageMaker notebook instance with lifecycle scripts, a PySpark ETL Glue job, a buffered S3 position archiver on the WebSocket server, and a one-time historical data upload script. The feature introduces a second CDK stack (`MlLabStack`) that depends on `AnalyticsStack` via a cross-stack bucket reference, adds real-time position archiving from the feed loop, and provisions SageMaker + AWS Glue infrastructure for ML dataset generation and analysis.

The architecture is sound. The stack separation is clean, the graceful degradation pattern (no-op when S3 is unconfigured) is correctly implemented, and the PySpark pipeline is well-structured with proper error isolation per dataset builder. The production-ready design of the position archiver — atomic buffer swap, fire-and-forget flush, structured logging — reflects good engineering judgment.

However, two critical bugs make the ML lab non-functional as deployed. First, all 7 Glue table schemas in `ml-lab-stack.ts` have column definitions that do not match the actual Parquet files written by `upload-historical-mta.ts`. Athena queries will return nulls or fail outright. Second, the SageMaker auto-stop lifecycle script uses a single-quoted heredoc delimiter, preventing bash variable expansion and causing the embedded Python script to contain a literal `${IDLE_TIME}` string — which is invalid Python syntax. The auto-stop process will crash immediately on notebook start, meaning the SageMaker instance will run indefinitely and accrue unbounded costs. Both bugs must be fixed before the ML lab is usable.

---

## Strengths

1. **Excellent graceful degradation.** The S3 client singleton (`server/src/lib/s3.ts`) returns `null` when `S3_BUCKET` is not set. The archiver checks for a null client and becomes a no-op. The server starts and operates normally without S3 configured. This is the correct pattern — new infrastructure should not be a prerequisite for the existing system to function.

2. **Clean stack separation.** `MlLabStack` is an independent CDK stack with a single cross-stack dependency: the S3 bucket exported from `AnalyticsStack`. The ML stack can be deployed and destroyed without touching the analytics or app stacks. Cross-stack references are handled correctly via `bucket.grantRead()` rather than hardcoded ARNs.

3. **Well-structured PySpark pipeline.** Each of the five dataset builders in `ml-dataset-pipeline.py` is self-contained with `try/except`, clear logging, and a graceful skip when source data is missing. The haversine UDF for speed calculation is mathematically correct. The pipeline will not fail catastrophically if one dataset builder errors.

4. **Production-ready archiver design.** The atomic buffer swap in `position-archiver.ts` (swap reference, flush old buffer) prevents race conditions where a new write could land in a buffer mid-flush. The fire-and-forget flush does not block the feed loop. Structured logging via pino is consistent with the rest of the server.

5. **Comprehensive upload script.** `upload-historical-mta.ts` includes dry-run mode, per-dataset error tracking, a summary table on completion, and cleanup of temporary Parquet files. This is more defensive than most one-time scripts.

6. **Cost-conscious design intent.** Notebook instance uses `ml.t3.medium` ($0.05/hr), Glue job is capped at 2 DPUs, S3 lifecycle rules transition data to IA then Glacier. The auto-stop intent is correct even though the implementation is broken (see C2).

7. **Follows existing project patterns.** The S3 client mirrors the `dynamodb.ts` singleton pattern exactly. The Lambda trigger for the ML Glue job mirrors the existing `glue-trigger` Lambda. The CDK resource naming follows the `railtime-*` convention used throughout `analytics-stack.ts`.

---

## Issues and Findings

### Critical Issues (must fix before use)

---

#### C1. Glue Table Schemas Do Not Match Actual Parquet Data

**File:** `infra/cdk/lib/ml-lab-stack.ts` (all 7 historical table definitions) vs. `scripts/upload-historical-mta.ts` (Parquet schema definitions)

**Severity:** Critical — Bug

All 7 Glue table definitions in `ml-lab-stack.ts` define column names and counts that do not match the Parquet files produced by `upload-historical-mta.ts`. Athena queries against these tables will return all-null result sets or fail with schema errors. The ML dataset pipeline reads S3 directly (bypassing the Glue catalog) so it is partially shielded, but any notebook cell using SQL via Athena will silently produce wrong results.

The mismatches, table by table:

**`daily_ridership`**

The CSV is a long-format table where each transit mode is a separate row. The upload script normalizes it to 3 columns:

```
# Actual Parquet schema (from upload-historical-mta.ts)
date       string
mode       string
count      bigint
```

The Glue table defines 15 wide columns:
```
# Glue schema (from ml-lab-stack.ts)
date                           string
subways_total_ridership        double
buses_total_ridership          double
lirr_total_ridership           double
metro_north_total_ridership    double
access_a_ride_total_ridership  double
bridges_and_tunnels_total      double
staten_island_railway          double
... (8 more columns)
```

These are the original CSV column headers transposed into wide format. The upload script intentionally pivots to long format — the Glue schema was never updated to match.

**`terminal_otp`**

```
# Actual Parquet (7 columns)
month                       string
division                    string
line                        string
day_type                    string
num_on_time_trips           bigint
num_sched_trips             bigint
terminal_on_time_performance double

# Glue schema (4 columns)
month       string
division    string
line        string
on_time_pct double   ← wrong name; missing 3 columns
```

**`fare_evasion`**

```
# Actual Parquet
time_period          string   ← Glue has: quarter
fare_evasion_pct     double   ← Glue has: estimated_fare_evasion_pct
margin_of_error      double   ← Glue has: estimated_fare_evasion_rides (wrong column entirely)

# Every column name is wrong.
```

**`mdbf`**

```
# Actual Parquet (8 columns)
month                string
division             string
car_class            string
mdbf                 double
total_miles          double   ← missing in Glue
number_of_failures   bigint   ← missing in Glue
number_of_cars       bigint   ← missing in Glue
twelve_month_avg_mdbf double  ← missing in Glue

# Glue schema (4 columns — missing 4 real columns)
```

**`customer_journey`**

```
# Actual Parquet (12 columns with names like)
month, division, line, day_type, additional_platform_time, ...

# Glue schema (4 columns)
month, metric_name, metric_value, division
← completely different structure; Glue has a generic metric_name/metric_value
  pivot that doesn't exist in the Parquet
```

**`service_delivered`**

```
# Actual Parquet
day_type               string
num_sched_trains       bigint
num_actual_trains      bigint
service_delivered_pct  double

# Glue schema
weekday_pct  double   ← wrong name and wrong structure
weekend_pct  double   ← fabricated column
total_pct    double   ← fabricated column
```

**`major_incidents`**

```
# Actual Parquet
month, division, line, day_type, num_major_incidents

# Glue schema
month, division, line, sub_category, incident_count
← sub_category doesn't exist; day_type missing; count column renamed
```

**Fix:** Rewrite all 7 Glue table column definitions in `ml-lab-stack.ts` to match the schemas produced by `upload-historical-mta.ts`. The upload script is the source of truth — it defines what is actually in S3. Run `cdk deploy MlLabStack` after fixing to recreate the Glue tables.

---

#### C2. SageMaker Auto-Stop Script Has Bash Variable Expansion Bug

**File:** `infra/cdk/lib/ml-lab-stack.ts`, lines 369–401 (onStart lifecycle script)

**Severity:** Critical — Bug, Cost Risk

The lifecycle script creates a Python autostop file using a heredoc:

```bash
IDLE_TIME=3600
cat > /home/ec2-user/autostop.py << 'SCRIPT'
...
    if is_idle(${IDLE_TIME}):
...
SCRIPT
```

The heredoc delimiter is `'SCRIPT'` (single-quoted). In bash, a single-quoted heredoc delimiter **suppresses all variable expansion and command substitution** within the heredoc body. The resulting Python file will literally contain:

```python
    if is_idle(${IDLE_TIME}):
```

This is invalid Python syntax. When `nohup python3 /home/ec2-user/autostop.py &` executes, Python will raise a `SyntaxError` on that line and exit immediately. The auto-stop daemon never runs.

**Impact:** The SageMaker notebook instance will never auto-stop due to inactivity. At `ml.t3.medium` pricing ($0.05/hr), a forgotten notebook costs $1.20/day or approximately $36/month continuously. The instance is currently deployed and likely running without auto-stop protection.

**Fix (preferred — hardcode the constant):**

```bash
cat > /home/ec2-user/autostop.py << 'SCRIPT'
...
    if is_idle(3600):
...
SCRIPT
```

**Fix (alternative — unquote the delimiter to enable variable expansion):**

```bash
cat > /home/ec2-user/autostop.py << SCRIPT
...
    if is_idle(${IDLE_TIME}):
...
SCRIPT
```

The preferred fix is to hardcode `3600` directly. The IDLE_TIME variable provides no additional flexibility since it is not configurable at runtime — hardcoding eliminates the heredoc quoting subtlety entirely. After fixing, redeploy and verify the lifecycle script runs by checking `/home/ec2-user/autostop.py` on the notebook instance for the literal integer.

---

### High Priority (should fix before running ML pipeline)

---

#### H1. EC2 IAM Role Mismatch Between CDK and Actual Infrastructure

**File:** `infra/cdk/lib/ml-lab-stack.ts`, `infra/cdk/lib/analytics-stack.ts`

**Severity:** High — Design / Infrastructure Drift

CDK creates and manages a role named `railtime-ws-server-dynamodb` with instance profile `railtime-ws-server`, and grants it `s3:PutObject` on `raw/positions/*`. However, the actual EC2 instance is attached to instance profile `railtime-ec2-profile` backed by role `railtime-ec2-dynamodb` — a pre-existing manually-created role. The S3 write permission was added as a workaround via `aws iam put-role-policy` directly on the manually-created role.

The CDK-managed role and instance profile are orphaned: they exist in CloudFormation state but are not attached to any resource. The inline policy added manually to `railtime-ec2-dynamodb` is invisible to CDK and will be wiped if CDK deletes and recreates that role, or if the manual policy is forgotten during infrastructure audits.

**Fix (Option A — preferred):** Import the existing role into CDK and grant S3 access on it:

```typescript
const ec2Role = iam.Role.fromRoleName(this, 'Ec2Role', 'railtime-ec2-dynamodb');
analyticsBucket.grantPut(ec2Role, 'raw/positions/*');
```

**Fix (Option B):** Migrate the EC2 instance to use the CDK-managed instance profile `railtime-ws-server`. This is a more disruptive change requiring an EC2 instance update but brings the instance fully under IaC management.

---

#### H2. `capturedAt` Timestamp Is Flush Time, Not Capture Time

**File:** `server/src/analytics/position-archiver.ts`, line 87

**Severity:** High — Data Quality Bug

```typescript
// Current code — assigns flush time to all buffered positions
const now = new Date().toISOString();
records = buffer.map(pos => ({
    ...pos,
    capturedAt: now,   // ← same timestamp for all records in the buffer
}));
```

The archiver flushes every 60 seconds. The feed loop polls every 15 seconds. A single flush contains positions from 4 different poll cycles, but all records receive the timestamp of the flush, not the timestamp when `archivePositions()` was called. This compresses 15-second temporal resolution to 60-second resolution in the archived data.

The `position_trajectory` dataset in `ml-dataset-pipeline.py` calculates `segment_speed` by dividing haversine distance by elapsed time between consecutive position records. If two consecutive records for the same train have identical `capturedAt` values, the time delta is zero and the speed calculation produces infinity or a division-by-zero error.

**Fix:** Capture the timestamp at call time (in the feed loop callback) and pass it through to the buffer record:

```typescript
// In position-archiver.ts
interface BufferedPosition extends TrainPosition {
    capturedAt: string;
}

archivePositions(positions: TrainPosition[], capturedAt: string): void {
    this.buffer.push(...positions.map(p => ({ ...p, capturedAt })));
}

// In the feed loop caller
const capturedAt = new Date().toISOString();
archiver.archivePositions(positions, capturedAt);
```

---

#### H3. Glue Dataset Pipeline References Wrong Column Names

**File:** `infra/cdk/glue-scripts/ml-dataset-pipeline.py`, `build_reliability_analysis()` and `build_service_analysis()`

**Severity:** High — Data Quality Bug

The PySpark pipeline reads S3 Parquet directly (not via Glue catalog), so it uses the actual Parquet column names. However, several column references in the pipeline match the wrong Glue schema names rather than the actual Parquet column names:

```python
# build_reliability_analysis() — line 217
otp_df = otp_df.withColumnRenamed("on_time_pct", "otp_rate")
# Actual column name: terminal_on_time_performance
# Effect: otp_rate will be null in all output rows

# build_service_analysis() — similar pattern
svc_df = svc_df.select("weekday_pct", "weekend_pct", ...)
# Actual columns: day_type, service_delivered_pct, num_sched_trains, num_actual_trains
# Effect: AnalysisException — column not found
```

This is a direct consequence of C1 — the Glue schema column names were used as a reference when writing the pipeline, but those names were wrong to begin with.

**Fix:** Audit all column references in `ml-dataset-pipeline.py` against the actual Parquet schemas defined in `upload-historical-mta.ts`. Update all column names to match actual Parquet output. Fix C1 and H3 together to ensure Glue catalog and pipeline code are consistent with the same source of truth.

---

### Medium Priority (address before production ML workloads)

---

#### M1. No Encryption on ML Bucket

**File:** `infra/cdk/lib/ml-lab-stack.ts`

**Severity:** Medium — Security

The `mlBucket` S3 bucket is created without specifying an encryption configuration. AWS S3 applies SSE-S3 by default since January 2023, but the CDK construct does not enforce this explicitly and does not use CMK encryption for sensitive ML datasets.

**Fix:**

```typescript
const mlBucket = new s3.Bucket(this, 'MlBucket', {
    bucketName: `railtime-ml-${this.account}`,
    encryption: s3.BucketEncryption.S3_MANAGED,
    // For sensitive data, prefer: s3.BucketEncryption.KMS_MANAGED
    ...
});
```

---

#### M2. `AmazonSageMakerFullAccess` Managed Policy Is Overly Permissive

**File:** `infra/cdk/lib/ml-lab-stack.ts`

**Severity:** Medium — Security / Least Privilege

The SageMaker notebook execution role attaches `AmazonSageMakerFullAccess`, which grants broad permissions including creating and deleting training jobs, endpoints, models, and pipeline executions. For a notebook-only use case (data exploration and ML prototyping), this violates least-privilege.

**Fix:** Remove the managed policy attachment and grant only the permissions actually needed:

```typescript
notebookRole.addToPolicy(new iam.PolicyStatement({
    actions: [
        'sagemaker:CreatePresignedNotebookInstanceUrl',
        'sagemaker:DescribeNotebookInstance',
        'sagemaker:StopNotebookInstance',
    ],
    resources: [notebookInstance.ref],
}));
// S3, Glue, Athena, and CloudWatch permissions are already granted explicitly — keep those.
// Remove: notebookRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'))
```

---

#### M3. No CloudWatch Alarm for ML Dataset Glue Job Failure

**File:** `infra/cdk/lib/ml-lab-stack.ts`

**Severity:** Medium — Observability

The existing `railtime-daily-rollup` Glue job in `analytics-stack.ts` has an EventBridge rule routing job state changes to an SNS alert topic (lines 411–422). The `railtime-ml-datasets` Glue job in `ml-lab-stack.ts` has no equivalent failure alerting. If the nightly ML ETL fails, stale datasets are silently served to notebooks with no notification.

**Fix:** Add an EventBridge rule for `railtime-ml-datasets` mirroring the pattern from `analytics-stack.ts`:

```typescript
new events.Rule(this, 'MlDatasetJobFailureRule', {
    eventPattern: {
        source: ['aws.glue'],
        detailType: ['Glue Job State Change'],
        detail: {
            jobName: ['railtime-ml-datasets'],
            state: ['FAILED', 'ERROR', 'TIMEOUT'],
        },
    },
    targets: [new targets.SnsTopic(alertTopic)],
});
```

---

#### M4. S3 Lifecycle Rule Overlap Between `raw/` and `raw/positions/`

**File:** `infra/cdk/lib/analytics-stack.ts`

**Severity:** Medium — Design / Maintainability

A lifecycle rule applies to the `raw/` prefix (30d→IA, 365d expire). A second rule applies specifically to `raw/positions/` (30d→IA, 90d→Glacier, 365d expire). S3 evaluates all matching rules for each object and applies the most cost-effective transitions, but the resulting behavior for objects under `raw/positions/` is non-obvious: both rules match, the Glacier transition from the second rule wins at day 90, and the expiration from either rule fires at day 365. The intent is not clear from reading either rule in isolation.

**Fix (preferred):** Replace the broad `raw/` rule with explicit prefix rules for each data type:

```typescript
{ prefix: 'raw/metrics/', transitionToIa: 30, expireAfter: 365 },
{ prefix: 'raw/events/',  transitionToIa: 30, expireAfter: 365 },
{ prefix: 'raw/positions/', transitionToIa: 30, transitionToGlacier: 90, expireAfter: 365 },
```

This makes the intent explicit and eliminates the overlap.

---

#### M5. `gzipSync` Blocks the Event Loop

**File:** `server/src/analytics/position-archiver.ts`, line 92

**Severity:** Medium — Performance

```typescript
const compressed = gzipSync(JSON.stringify(records));
```

`gzipSync` is a synchronous call that blocks the Node.js event loop while compressing. At current scale (approximately 325 records per flush for the largest feed group), this is fast (~1–2ms) and not immediately harmful. However, as position data volume grows and buffer sizes increase, this will introduce latency spikes that delay Socket.IO broadcasts and feed loop processing, both of which run on the same thread.

**Fix:**

```typescript
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

// In flush():
const compressed = await gzipAsync(JSON.stringify(records));
```

The flush function is already async, so this change is straightforward.

---

#### M6. `mode("overwrite")` Destroys Historical Real-Time Processed Data

**File:** `infra/cdk/glue-scripts/ml-dataset-pipeline.py`

**Severity:** Medium — Design

All five dataset builders use `mode("overwrite")` when writing output. For historical datasets (ridership forecasting, reliability analysis), this is correct — the source data is static and a full rewrite is appropriate. For real-time datasets (delay prediction, anomaly detection, position trajectory), the source read window is restricted to the last 7 days:

```python
def read_recent_json(path: str, days: int = 7) -> DataFrame:
    cutoff = datetime.now() - timedelta(days=days)
    ...
```

With `mode("overwrite")`, each nightly run replaces the entire output partition with only the last 7 days of processed data. After 30 days of operation, only 7 days of processed ML features will exist in the output — even though 30 days of raw position data is available in S3. Any model trained on the processed output will have insufficient history.

**Fix (Option A — expand the read window):** Change `days=7` to `days=90` or `days=365` and read all available raw data on each run. Cost and runtime will increase proportionally.

**Fix (Option B — use append with date partitioning):**

```python
df.write \
    .mode("append") \
    .partitionBy("processing_date") \
    .parquet(output_path)
```

Add deduplication logic at read time to avoid double-processing the same source records.

---

### Low Priority (cleanup and polish)

---

#### L1. Hardcoded Windows Path in Upload Script

**File:** `scripts/upload-historical-mta.ts`, line 118

**Severity:** Low — Portability

```typescript
const CSV_SOURCE_DIR = 'C:\\Users\\User\\Downloads\\mtaData';
```

This is a one-time script, but the hardcoded Windows path makes it non-portable and will fail immediately on any other machine or in a CI environment.

**Fix:** Accept the source directory as a CLI argument with the Windows path as the default:

```typescript
const CSV_SOURCE_DIR = process.argv[2] ?? 'C:\\Users\\User\\Downloads\\mtaData';
```

---

#### L2. Zero Test Coverage for All New Server Code

**File:** `server/src/` — no test files found

**Severity:** Low — Test Coverage

No unit tests exist for any of the new server-side code: `s3.ts`, `position-archiver.ts`, the `transit-analyzer.ts` additions, or the CDK stack synthesis. The position archiver contains non-trivial logic (atomic buffer swap, flush timer, retry behavior) that is well-suited to unit testing.

**Minimum test additions recommended:**

1. CDK snapshot test for `MlLabStack` — catches accidental resource mutations in future stack edits.
2. Unit test for `position-archiver.ts` buffer/flush logic with a mocked S3 client — verifies atomic swap, flush on interval, flush on shutdown.
3. Unit test for the transform functions in `upload-historical-mta.ts` — verifies the long-format pivot for `daily_ridership` and schema normalization for each CSV type.

---

#### L3. Duplicated Windowing Logic in PySpark Pipeline

**File:** `infra/cdk/glue-scripts/ml-dataset-pipeline.py`

**Severity:** Low — Maintainability

`build_delay_prediction()` and `build_anomaly_detection()` share approximately 80% of the same logic: windowed aggregation over position records, metric feature extraction from the events table, a pivot/join step, and output schema enforcement. When the windowing parameters or feature set changes, both builders must be updated in sync.

**Fix:** Extract a shared helper:

```python
def build_windowed_features(
    positions_df: DataFrame,
    events_df: DataFrame,
    window_hours: int = 24,
) -> DataFrame:
    ...

# Then in each builder:
features = build_windowed_features(positions_df, events_df)
```

---

## Architecture Considerations

### Stack Dependency Model

`MlLabStack` takes a single constructor parameter — the `analyticsBucket` from `AnalyticsStack`. This is a CDK cross-stack reference resolved at synth time. The dependency graph is: `AnalyticsStack` must deploy first; `MlLabStack` can be torn down independently without affecting analytics. This is the correct pattern for optional/experimental infrastructure.

The Lambda trigger (`ml-dataset-trigger`) fires on a daily EventBridge schedule and invokes the `railtime-ml-datasets` Glue job. This mirrors the `glue-trigger` Lambda pattern in `analytics-stack.ts` exactly — good consistency.

### Data Lineage

```
MTA CSV files (one-time)
  → upload-historical-mta.ts
  → S3: raw/historical/{dataset}/*.parquet
  → Glue Catalog: railtime_analytics DB → historical tables (C1 currently broken)
  → Athena queries from notebooks

Feed loop (real-time, 15s)
  → position-archiver.ts (60s buffer flush, H2 timestamp issue)
  → S3: raw/positions/{date}/*.json.gz

EventBridge daily schedule
  → ml-dataset-trigger Lambda
  → railtime-ml-datasets Glue job
  → ml-dataset-pipeline.py (H3 column name issues; M6 overwrite issue)
  → S3: processed/{dataset}/
  → SageMaker notebook reads processed/
```

### SageMaker Notebook Access Pattern

The notebook instance accesses S3 via the `notebookRole` IAM role. Permissions are granted using CDK `bucket.grantRead()` and `bucket.grantReadWrite()` — this is correct and avoids hardcoded ARNs. The Athena results bucket and output location are configured correctly. The Glue catalog access uses a managed policy grant, which is appropriate.

### Performance and Cost Profile

The current scale (approximately 1,300 position records per 60-second flush across all feed groups) produces roughly 2,000 JSON.gz files per day. At S3 pricing, storage cost is negligible for the first 30 days. The Glue job at 2 DPUs processes these files well within the daily schedule window. The primary cost risk is the SageMaker notebook instance (see C2).

### Security Posture

The `mlBucket` should have server-side encryption explicitly configured (M1). The `notebookRole` over-grants via `AmazonSageMakerFullAccess` (M2). All other IAM grants are specific and scoped to the minimum necessary resources. The bucket blocks public access and has versioning enabled — both correct.

---

## Testing and Coverage

| Component | Unit Tests | Integration Tests |
|---|---|---|
| `s3.ts` | None | None |
| `position-archiver.ts` | None | None |
| `transit-analyzer.ts` additions | None | None |
| `upload-historical-mta.ts` | None | None |
| `ml-lab-stack.ts` (CDK synth) | None | None |
| `ml-dataset-pipeline.py` (PySpark) | None | None |

The rest of the server codebase (`server/src/`) has no test files at all. The Next.js app has 44 test files with 662 passing tests. The new analytics code introduced in this feature adds non-trivial logic — particularly the archiver's buffer management — without any test coverage. See L2 for the minimum recommended additions.

---

## Consistency with Project Standards

| Standard | Status |
|---|---|
| Singleton client pattern (mirrors `dynamodb.ts`) | Correct |
| Graceful degradation via null check | Correct |
| Structured logging with pino | Correct |
| CDK resource naming (`railtime-*`) | Correct |
| Cross-stack references via CDK constructs (not hardcoded ARNs) | Correct |
| Error envelope pattern in Lambda handler | Correct |
| Feed loop callback pattern | Correct |
| EventBridge + Lambda → Glue pattern | Correct |
| IAM least-privilege | Partial (M2) |
| IaC completeness (all infra in CDK) | Partial (H1 — one inline policy outside CDK) |

---

## Overall Assessment

**Verdict: Needs Work — two critical bugs must be fixed before the ML lab is usable.**

The feature is architecturally sound and the implementation quality is generally high. The graceful degradation design, clean stack separation, and pattern consistency are all commendable. The three-tier data flow (historical upload, real-time archiving, daily ETL) is correctly structured.

However, C1 (Glue schema mismatches) and C2 (broken auto-stop script) make the ML lab non-functional and financially risky as currently deployed. H1 through H3 should be resolved before running the first ML dataset pipeline job, as they affect data quality in ways that will silently corrupt model training data. The medium-priority findings (M1–M6) are improvements to security posture, observability, and correctness that should be addressed before any production ML workloads run against this infrastructure.

**Immediate actions required:**

1. Fix C2 (auto-stop bash bug) — stop ongoing cost accrual. Deploy immediately.
2. Fix C1 (Glue table schemas) — redeploy stack to recreate Glue tables.
3. Fix H3 (pipeline column names) — re-upload Glue script and re-run pipeline.
4. Fix H2 (capturedAt timestamp) — deploy server fix; no historical data can be corrected.
5. Address H1 (IAM role alignment) before next `cdk deploy` to avoid inline policy loss.
