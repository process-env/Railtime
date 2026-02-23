Last Updated: 2026-02-23

# ml-lab-stack — Remediation Tasks

Derived from the code review at `dev/review/ml-lab-stack/ml-lab-stack-review.md`. Tasks are ordered by priority within each group. Fix Critical group items before running any ML pipeline jobs. Fix Data Integrity items before trusting any model training output.

---

## Critical Fixes

These two bugs make the ML lab non-functional and financially risky as deployed. Fix both immediately and redeploy.

- [ ] **Fix SageMaker auto-stop bash heredoc bug** — Critical, Effort S — The single-quoted heredoc delimiter `'SCRIPT'` prevents bash variable expansion, causing the autostop Python script to contain a literal `${IDLE_TIME}` string (invalid Python syntax). The auto-stop daemon crashes on notebook start, leaving the instance running indefinitely at $0.05/hr. Fix: change `'SCRIPT'` to `SCRIPT` or hardcode `3600` directly in the Python code (preferred). Redeploy lifecycle config and verify. See review §C2.

- [ ] **Rewrite all 7 Glue table schemas to match actual Parquet column definitions** — Critical, Effort M — Every Glue table in `ml-lab-stack.ts` has wrong column names and/or counts relative to the Parquet files written by `upload-historical-mta.ts`. The upload script is the source of truth. Athena queries on all historical tables currently return nulls or schema errors. Fix: audit each table schema against the upload script's transform output and rewrite. Run `cdk deploy MlLabStack` to recreate tables. Affected tables: `daily_ridership`, `terminal_otp`, `fare_evasion`, `mdbf`, `customer_journey`, `service_delivered`, `major_incidents`. See review §C1.

---

## Data Integrity

Fix before running ML dataset pipeline jobs or training any models. Silent data quality bugs will corrupt training data without errors.

- [ ] **Fix `capturedAt` timestamp: capture at poll time, not flush time** — High, Effort S — The position archiver assigns the flush timestamp to all buffered positions, collapsing 4 poll cycles (15s each) into a single 60-second timestamp. Speed calculations in the `position_trajectory` dataset divide by time delta; identical timestamps produce infinity or divide-by-zero. Fix: add a `capturedAt: string` parameter to `archivePositions()`, set it in the feed loop callback at poll time, and store it per-record. No historical data can be corrected after this fix — accept the loss for data prior to the fix. See review §H2.

- [ ] **Fix PySpark pipeline column name references to match actual Parquet schemas** — High, Effort S — `build_reliability_analysis()` references `on_time_pct` (actual column: `terminal_on_time_performance`) and `build_service_analysis()` references `weekday_pct`, `weekend_pct` (actual columns: `day_type`, `service_delivered_pct`, `num_sched_trains`, `num_actual_trains`). These mismatches cause the pipeline to produce null output or fail with column-not-found errors. Fix: audit all column references in `ml-dataset-pipeline.py` against the upload script schemas. Fix C1 and this together — both should reference the same source of truth. See review §H3.

- [ ] **Change real-time dataset writes from `mode("overwrite")` to `mode("append")` with date partitioning** — Medium, Effort M — The delay prediction, anomaly detection, and position trajectory datasets use a 7-day source read window but `mode("overwrite")` on output. Each nightly run replaces all processed history with only 7 days of data. After 30 days, ML models cannot access training data older than 7 days even though raw data in S3 extends back further. Fix: switch real-time builders to `mode("append")` with `partitionBy("processing_date")` and add deduplication at read time. Alternatively, expand the source read window to 90+ days. See review §M6.

---

## Infrastructure and Security

Fix before the next `cdk deploy` or before production ML workloads.

- [ ] **Align EC2 IAM role with CDK management: import existing role or migrate instance** — High, Effort M — CDK creates role `railtime-ws-server-dynamodb` which is never attached to the EC2 instance. The actual instance uses manually-created role `railtime-ec2-dynamodb`. S3 write permissions were added to the manual role via `aws iam put-role-policy` (outside CDK). If `cdk deploy` recreates the manual role or the inline policy is lost, archiver S3 writes will fail silently. Fix (preferred): import the existing role with `iam.Role.fromRoleName(this, 'Ec2Role', 'railtime-ec2-dynamodb')` and grant S3 access on it. Remove the orphaned CDK-managed role. See review §H1.

- [ ] **Add explicit S3 encryption to `mlBucket`** — Medium, Effort S — The ML bucket has no explicit encryption configuration. Add `encryption: s3.BucketEncryption.S3_MANAGED` at minimum to make the encryption posture explicit and auditable. For sensitive ML datasets, consider `KMS_MANAGED`. See review §M1.

- [ ] **Replace `AmazonSageMakerFullAccess` with scoped permissions on notebook role** — Medium, Effort S — The managed policy grants permissions to create/delete training jobs, endpoints, and pipeline executions — none of which are needed for a notebook-only use case. Remove the managed policy and grant only `sagemaker:CreatePresignedNotebookInstanceUrl`, `sagemaker:DescribeNotebookInstance`, and `sagemaker:StopNotebookInstance` on the specific notebook instance ARN. The S3, Glue, Athena, and CloudWatch grants already in place cover all actual notebook access needs. See review §M2.

- [ ] **Resolve or document S3 lifecycle rule overlap on `raw/` and `raw/positions/` prefixes** — Medium, Effort S — Two lifecycle rules apply to `raw/positions/` objects: the broad `raw/` rule (30d→IA, 365d expire) and the specific `raw/positions/` rule (30d→IA, 90d→Glacier, 365d expire). The overlap is confusing and the effective behavior is non-obvious. Fix: replace the `raw/` rule with explicit prefix rules for `raw/metrics/`, `raw/events/`, and `raw/positions/`, eliminating the overlap. See review §M4.

---

## Observability

- [ ] **Add EventBridge failure alert for `railtime-ml-datasets` Glue job** — Medium, Effort S — The production `railtime-daily-rollup` Glue job has an EventBridge rule routing failure states to SNS. The ML datasets Glue job has no equivalent. Silent ETL failures will serve stale data to notebooks without notification. Fix: add an EventBridge rule for `railtime-ml-datasets` job state `FAILED | ERROR | TIMEOUT` targeting the existing SNS alert topic, mirroring the pattern at `analytics-stack.ts` lines 411–422. See review §M3.

---

## Performance

- [ ] **Replace `gzipSync` with async `gzip` in position archiver** — Medium, Effort S — `gzipSync` is synchronous and blocks the Node.js event loop during compression. At current scale (~1,300 records per flush, ~650KB uncompressed) the block is approximately 1–2ms and not immediately harmful, but will grow with data volume. The feed loop and Socket.IO broadcasts share the same thread. Fix: use `util.promisify(gzip)` from `node:zlib`. The flush function is already async, so the change is a one-line swap. See review §M5.

---

## Testing

- [ ] **Add minimum test coverage for new server-side analytics code** — Low, Effort M — Zero tests exist for any new server code (`s3.ts`, `position-archiver.ts`, `transit-analyzer.ts` additions). The position archiver contains non-trivial logic (atomic buffer swap, flush timer, shutdown flush) that warrants unit testing. Minimum required: (1) CDK snapshot test for `MlLabStack` to catch accidental resource mutations in future edits; (2) unit test for `position-archiver.ts` buffer/flush logic with a mocked S3 client, covering normal flush, shutdown flush, and null-client no-op behavior; (3) unit test for transform functions in `upload-historical-mta.ts` covering the long-format pivot for `daily_ridership` and schema normalization for each CSV type. See review §L2.

---

## Cleanup

- [ ] **Accept source directory as CLI argument in upload script** — Low, Effort S — `CSV_SOURCE_DIR` is hardcoded to `C:\\Users\\User\\Downloads\\mtaData`, making the script non-portable. Fix: `const CSV_SOURCE_DIR = process.argv[2] ?? 'C:\\\\Users\\\\User\\\\Downloads\\\\mtaData'`. This is a one-time script but should be runnable on any machine for future re-uploads. See review §L1.

- [ ] **Extract shared `build_windowed_features()` helper in PySpark pipeline** — Low, Effort S — `build_delay_prediction()` and `build_anomaly_detection()` share approximately 80% of the same windowed aggregation, feature extraction, pivot, and join logic. Changes to the windowing parameters or feature set require duplicate edits. Fix: extract a `build_windowed_features(positions_df, events_df, window_hours)` helper function and call it from both builders. See review §L3.

---

## Summary by Priority

| Priority | Count | Estimated Total Effort |
|---|---|---|
| Critical | 2 | S + M |
| High | 3 | S + S + M |
| Medium | 5 | M + S + S + S + S |
| Low | 3 | M + S + S |
| **Total** | **13** | |

**Deploy order for critical fixes:**
1. Fix C2 (auto-stop bash bug) → redeploy SageMaker lifecycle config → verify `/home/ec2-user/autostop.py` on instance
2. Fix C1 (Glue schemas) + H3 (pipeline column names) together → `cdk deploy MlLabStack` → re-run Glue job → verify Athena query results
3. Fix H2 (capturedAt) → deploy server → confirm per-record timestamps in new S3 objects
4. Fix H1 (IAM role) → `cdk deploy` → verify archiver still writes to S3 successfully
