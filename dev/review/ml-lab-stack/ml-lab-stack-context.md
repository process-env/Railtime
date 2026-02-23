Last Updated: 2026-02-23

# ml-lab-stack — Review Context

## Files Reviewed

| File | Lines | Role |
|---|---|---|
| `infra/cdk/lib/ml-lab-stack.ts` | 520 | CDK stack: SageMaker, Glue, S3, IAM, EventBridge, Glue Data Catalog |
| `infra/cdk/lib/analytics-stack.ts` | 480 | Modified: bucket export, lifecycle rules, Glue crawler, IAM grants |
| `infra/cdk/bin/app.ts` | 25 | CDK app entry — stack instantiation and wiring |
| `infra/cdk/lambda/ml-dataset-trigger/index.ts` | 19 | EventBridge → Glue job trigger Lambda |
| `infra/cdk/glue-scripts/ml-dataset-pipeline.py` | 616 | PySpark ETL: 5 ML dataset builders |
| `server/src/lib/s3.ts` | 51 | S3 client singleton with null-safe configuration guard |
| `server/src/analytics/position-archiver.ts` | 159 | Buffered position writer: 60s flush interval, gzip, S3 PutObject |
| `server/src/analytics/transit-analyzer.ts` | 237 | Added `writeEvents()` for analysis event persistence |
| `server/src/index.ts` | 211 | Feed loop integration: archiver init, shutdown signal wiring |
| `scripts/upload-historical-mta.ts` | 649 | One-time script: MTA CSV → Parquet → S3 upload for historical datasets |
| `notebooks/01-ridership-forecasting.ipynb` | — | Prophet + XGBoost forecasting (runnable day 1) |
| `notebooks/02-reliability-mdbf-analysis.ipynb` | — | MDBF + Random Forest reliability analysis (runnable day 1) |
| `notebooks/03-delay-prediction.ipynb` | — | XGBoost delay classification (requires 3+ days of real-time data) |

---

## Architectural Context

### How MlLabStack Relates to AnalyticsStack

`AnalyticsStack` is the parent data infrastructure stack. It owns the primary analytics S3 bucket (`railtime-analytics-{account}`), the daily rollup Glue job, the Glue Data Catalog database (`railtime_analytics`), and the existing EventBridge/SNS alerting pattern. In the v2 implementation, `AnalyticsStack` was modified to export the analytics bucket as a CDK cross-stack reference and to add lifecycle rules for `raw/positions/` data written by the new archiver.

`MlLabStack` depends on `AnalyticsStack` through a single constructor argument: the `analyticsBucket` reference. This is resolved at CDK synth time. `MlLabStack` adds:

- A separate ML-dedicated S3 bucket (`railtime-ml-{account}`) for processed ML datasets and notebook output
- 7 Glue Data Catalog tables pointing at historical Parquet data in `analyticsBucket`
- A second Glue ETL job (`railtime-ml-datasets`) reading from `analyticsBucket` and writing to `mlBucket`
- A daily EventBridge schedule → Lambda → Glue job trigger
- A SageMaker notebook instance with a configured execution role
- A SageMaker lifecycle configuration (onStart script) with auto-stop logic

The stacks are deployed in sequence: `AnalyticsStack` first, then `MlLabStack`. The ML stack can be destroyed independently without affecting `AnalyticsStack` or the application stack.

### How the Server Feed Loop Integrates

The WebSocket server (`server/src/index.ts`) runs the MTA GTFS-RT feed loop on a 15-second interval. The v2 feature adds an `archivePositions()` call inside the feed loop callback, immediately after train positions are broadcast to Socket.IO clients. The position archiver holds an in-memory buffer and flushes to S3 on a separate 60-second timer.

The archiver is initialized at server startup with a null-safe S3 client. If `S3_BUCKET` is not set in the environment, `getS3Client()` returns `null`, the archiver detects this in its constructor, and all `archivePositions()` calls become no-ops. The server starts and operates normally without S3 configured — the feed loop, Socket.IO broadcasts, and all other functionality are unaffected.

Shutdown signal handlers (`SIGTERM`, `SIGINT`) flush the archiver buffer before process exit to avoid losing buffered positions.

### How the Upload Script Fits

`scripts/upload-historical-mta.ts` is a one-time operational script, not part of any build or CI pipeline. It reads 7 MTA historical CSV datasets from a local directory, transforms each into a normalized Parquet schema, and uploads to `s3://railtime-analytics-{account}/raw/historical/{dataset}/`. The resulting Parquet files are the source of truth for the Glue table schemas in `ml-lab-stack.ts` — and the current mismatch between them (finding C1) is the most critical defect in this feature.

The script uses `@aws-sdk/client-s3` directly with local credentials and is intended to be run once during initial ML lab provisioning. It includes dry-run mode, per-dataset error tracking, and cleanup of temporary local files.

### How the Notebooks Fit

The three Jupyter notebooks run inside the SageMaker notebook instance. They authenticate to AWS via the `notebookRole` IAM role attached to the instance. They access data via two paths:

1. **Athena SQL** — queries the Glue Data Catalog tables to read historical Parquet data from `analyticsBucket`. This path is currently broken due to the Glue schema mismatches (C1).
2. **Direct S3 read via `awswrangler`** — reads Parquet files directly from `mlBucket/processed/` after the Glue ETL job has run. This path is partially broken due to wrong column references in the pipeline (H3).

Notebooks 01 and 02 use primarily historical data and can run on day 1 after the historical upload. Notebook 03 requires at least 3 days of real-time position data in `raw/positions/` before the delay prediction dataset has sufficient records.

---

## Design Decisions Made

### Separate Stack (MlLabStack vs. extending AnalyticsStack)

The ML lab infrastructure was placed in a separate CDK stack rather than extending `AnalyticsStack` because:

1. The ML lab is experimental/optional infrastructure. It can be destroyed without affecting the core analytics pipeline.
2. The SageMaker notebook and Glue ML job have different deployment lifecycles than the production analytics stack.
3. Keeping `AnalyticsStack` focused on production data infrastructure (daily rollup, alerting) separates concerns and limits blast radius if ML-specific resources need to change.

The trade-off is that CDK cross-stack references create a deployment order dependency and can be brittle if the exporting stack changes its output names. The single exported reference (`analyticsBucket`) is stable enough to justify the separation.

### Cross-Stack Reference via CDK Constructs (Not Hardcoded ARNs)

The `analyticsBucket` is passed as a CDK `IBucket` construct reference rather than resolved to an ARN string. This means IAM grants (`bucket.grantRead()`, `bucket.grantPut()`) are generated by CDK with the correct ARN at synth time. The alternative — hardcoding the bucket ARN — would work but would break if the bucket is ever renamed or the account changes, and would not benefit from CDK's IAM grant helpers.

### Fire-and-Forget Archiver Pattern

The `position-archiver.ts` flush is called as a fire-and-forget (`this.flush().catch(logger.error)`) from the flush timer callback. The flush itself is async (S3 PutObject), but the timer callback does not await it. This was a deliberate decision to avoid blocking the event loop or introducing back-pressure into the feed loop.

The trade-off is that if a flush takes longer than 60 seconds (e.g., due to S3 latency spike), the next timer tick could initiate a second concurrent flush. The atomic buffer swap mitigates this: each flush captures its own snapshot of the buffer, so concurrent flushes will write different data sets rather than duplicating records. The risk is acceptable given the low S3 latency expectations and the small payload size.

### Flush Timer Pattern (60 seconds)

60 seconds was chosen as the flush interval to balance:

- **Write frequency**: S3 PutObject has a per-request cost. Flushing too frequently (e.g., every 15s, matching the feed loop) would quadruple S3 API costs.
- **Data freshness for ML**: ML training data does not require sub-minute temporal resolution. 60-second granularity is sufficient for speed estimation and delay prediction.
- **Memory usage**: At ~325 positions per feed cycle × 4 cycles per flush = ~1,300 records per flush. At approximately 500 bytes per record, this is ~650KB per flush, well within acceptable in-memory buffering.

The consequence of the 60-second window is that `capturedAt` resolution is degraded (H2). This was either not considered or was considered an acceptable trade-off at design time.

### S3 Client Singleton Pattern

`server/src/lib/s3.ts` follows the same pattern as `server/src/lib/dynamodb.ts` and `server/src/lib/redis.ts`: a module-level singleton initialized once, exported as a single reference. This ensures a single AWS SDK client instance per process, which is the correct pattern for connection reuse and credential caching. The null-return guard when `S3_BUCKET` is unset follows the same pattern used by the Redis client when `REDIS_URL` is unset.

---

## Known Constraints

### EC2 Instance Profile Mismatch (H1)

The actual EC2 instance running the WebSocket server uses instance profile `railtime-ec2-profile` backed by role `railtime-ec2-dynamodb`. This role was created manually before CDK was introduced to the project. CDK creates a separate role (`railtime-ws-server-dynamodb`) and instance profile (`railtime-ws-server`) which are not attached to any running resource. The S3 write permissions needed by the archiver were added as an inline policy directly to the manually-created role via `aws iam put-role-policy`.

This is a known infrastructure drift issue. The workaround is functional but fragile — the inline policy is invisible to CDK and will not survive a CDK-driven role deletion. The correct fix (H1) is to import the existing role into CDK using `iam.Role.fromRoleName()`.

---

## Trade-offs

### `gzipSync` vs. Async Gzip (M5)

`gzipSync` was used for simplicity. At current data volumes (~1,300 records, ~650KB uncompressed), the synchronous call completes in approximately 1–2ms and does not measurably affect event loop latency. The async alternative (`util.promisify(gzip)`) is strictly better for correctness under load but adds a small complexity cost (the flush function is already async, so the change is minimal). The sync version is acceptable at current scale but should be replaced before data volumes grow.

### `mode("overwrite")` vs. `mode("append")` for Real-Time Datasets (M6)

`mode("overwrite")` was used uniformly across all dataset builders for simplicity — it guarantees idempotent reruns and avoids deduplication logic. For historical datasets (static source data), this is correct. For real-time datasets (rolling 7-day source window), overwrite means processed history is lost beyond the read window. The append alternative requires partitioning and deduplication but preserves full history. The correct fix depends on the intended historical depth for ML training — if 7 days is sufficient for model training, overwrite is acceptable; if longer history is needed, append with partitioning is required.

---

## References

- Plan file: `dev/active/ml-lab/ml-lab-plan.md`
- Task list: `dev/review/ml-lab-stack/ml-lab-stack-tasks.md`
- Full review: `dev/review/ml-lab-stack/ml-lab-stack-review.md`
- Analytics stack baseline: `infra/cdk/lib/analytics-stack.ts`
- Server pattern reference: `server/src/lib/dynamodb.ts`, `server/src/lib/redis.ts`
- Existing Glue trigger pattern: `infra/cdk/lambda/glue-trigger/index.ts`
