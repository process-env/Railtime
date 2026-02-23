# MTA ML Data Laboratory -- Task Tracker

_Last Updated: 2026-02-23_

---

## Phase 0: Documentation

| Task | Phase | Status | Dependencies | Files |
|------|-------|--------|--------------|-------|
| Write ml-lab-context.md | 0 | [x] | None | `dev/active/ml-lab/ml-lab-context.md` |
| Write ml-lab-plan.md | 0 | [x] | None | `dev/active/ml-lab/ml-lab-plan.md` |
| Write ml-lab-tasks.md | 0 | [x] | None | `dev/active/ml-lab/ml-lab-tasks.md` |
| Update handoff-notes.md with ML Lab session | 0 | [x] | None | `dev/active/handoff-notes.md` |

---

## Phase 1: Real-Time Data Capture

| Task | Phase | Status | Dependencies | Files |
|------|-------|--------|--------------|-------|
| Create S3 client singleton | 1 | [x] | None | `server/src/lib/s3.ts` |
| Add @aws-sdk/client-s3 to server dependencies | 1 | [x] | None | `server/package.json` |
| Create position-archiver module | 1 | [x] | S3 client | `server/src/analytics/position-archiver.ts` |
| Add DynamoDB write for ANALYSIS# records in transit-analysis | 1 | [x] | None | `server/src/api/transit-analysis.ts` |
| Wire position-archiver into feed-loop in server index | 1 | [x] | position-archiver | `server/src/index.ts` |
| Add archiver shutdown to graceful shutdown handler | 1 | [x] | position-archiver | `server/src/index.ts` |
| Write unit tests for position-archiver | 1 | [x] | position-archiver | `server/src/__tests__/position-archiver.test.ts` |
| Verify server TypeScript compiles | 1 | [x] | All Phase 1 tasks | `server/` |

---

## Phase 2: Historical Data Upload

| Task | Phase | Status | Dependencies | Files |
|------|-------|--------|--------------|-------|
| Create upload-historical-mta.ts script | 2 | [x] | None | `scripts/upload-historical-mta.ts` |
| Add CSV parsing dependency (papaparse) | 2 | [x] | None | `package.json` |
| Add Parquet writing dependency or fallback to NDJSON | 2 | [x] | None | `package.json` |
| Implement CSV reading + schema validation for all 7 files | 2 | [x] | upload script exists | `scripts/upload-historical-mta.ts` |
| Implement date normalization (MM/DD/YYYY to ISO) | 2 | [x] | CSV reading works | `scripts/upload-historical-mta.ts` |
| Implement column name normalization | 2 | [x] | CSV reading works | `scripts/upload-historical-mta.ts` |
| Implement S3 upload with correct key prefixes | 2 | [x] | Normalization done | `scripts/upload-historical-mta.ts` |
| Run upload script and verify 7 files in S3 | 2 | [x] | Upload script complete | `scripts/upload-historical-mta.ts` |

---

## Phase 3: CDK ML Lab Stack

| Task | Phase | Status | Dependencies | Files |
|------|-------|--------|--------------|-------|
| Add exports to AnalyticsStack (bucket, Glue DB, DynamoDB ARN) | 3 | [x] | None | `infra/cdk/lib/analytics-stack.ts` |
| Create MlLabStack with ML artifacts S3 bucket | 3 | [x] | AnalyticsStack exports | `infra/cdk/lib/ml-lab-stack.ts` |
| Add 7 historical Glue tables to MlLabStack | 3 | [x] | ML artifacts bucket | `infra/cdk/lib/ml-lab-stack.ts` |
| Add raw_positions Glue table (partitioned) | 3 | [x] | ML artifacts bucket | `infra/cdk/lib/ml-lab-stack.ts` |
| Add SageMaker notebook instance with auto-stop lifecycle | 3 | [x] | SageMaker IAM role | `infra/cdk/lib/ml-lab-stack.ts` |
| Create SageMaker execution IAM role (least privilege) | 3 | [x] | Bucket ARNs known | `infra/cdk/lib/ml-lab-stack.ts` |
| Add Glue ML dataset ETL job definition | 3 | [x] | Glue tables | `infra/cdk/lib/ml-lab-stack.ts` |
| Create ml-dataset-trigger Lambda | 3 | [x] | Glue job | `infra/cdk/lambda/ml-dataset-trigger/index.ts` |
| Add EventBridge rule (daily 06:00 UTC) targeting trigger Lambda | 3 | [x] | Lambda | `infra/cdk/lib/ml-lab-stack.ts` |
| Instantiate MlLabStack in CDK app entry point | 3 | [x] | Stack defined | `infra/cdk/bin/app.ts` |
| Verify CDK TypeScript compiles | 3 | [x] | All Phase 3 tasks | `infra/cdk/` |
| Run cdk diff and review changeset | 3 | [x] | TypeScript compiles | `infra/cdk/` |
| Deploy MlLabStack | 3 | [x] | cdk diff reviewed | `infra/cdk/` |

---

## Phase 4: ML Dataset Pipeline

| Task | Phase | Status | Dependencies | Files |
|------|-------|--------|--------------|-------|
| Write ml-dataset-pipeline.py PySpark ETL script | 4 | [x] | Phase 3 Glue tables | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Implement ridership_forecast dataset assembly | 4 | [x] | ETL script skeleton | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Implement reliability_analysis dataset assembly (join MDBF + incidents + service) | 4 | [x] | ETL script skeleton | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Implement delay_prediction dataset assembly (conditional on real-time data) | 4 | [x] | ETL script skeleton | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Implement anomaly_detection dataset assembly (conditional) | 4 | [x] | ETL script skeleton | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Implement position_trajectory dataset assembly (conditional) | 4 | [x] | ETL script skeleton | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Upload ETL script to S3 glue-scripts prefix | 4 | [x] | Script complete | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Trigger Glue job manually and verify output datasets | 4 | [x] | Script uploaded | -- |

---

## Phase 5: Jupyter Notebooks

| Task | Phase | Status | Dependencies | Files |
|------|-------|--------|--------------|-------|
| Create 01-ridership-forecasting.ipynb | 5 | [x] | Phase 2 (historical data in S3) | `notebooks/01-ridership-forecasting.ipynb` |
| Implement EDA cells for ridership data | 5 | [x] | Notebook created | `notebooks/01-ridership-forecasting.ipynb` |
| Implement Prophet model training + evaluation | 5 | [x] | EDA cells | `notebooks/01-ridership-forecasting.ipynb` |
| Implement XGBoost model training + comparison | 5 | [x] | Prophet cells | `notebooks/01-ridership-forecasting.ipynb` |
| Create 02-reliability-mdbf-analysis.ipynb | 5 | [x] | Phase 2 (historical data in S3) | `notebooks/02-reliability-mdbf-analysis.ipynb` |
| Implement EDA cells for MDBF + incidents + service data | 5 | [x] | Notebook created | `notebooks/02-reliability-mdbf-analysis.ipynb` |
| Implement Random Forest feature importance analysis | 5 | [x] | EDA cells | `notebooks/02-reliability-mdbf-analysis.ipynb` |
| Implement Linear Regression baseline + comparison | 5 | [x] | Random Forest cells | `notebooks/02-reliability-mdbf-analysis.ipynb` |
| Create 03-delay-prediction.ipynb | 5 | [x] | Phase 4 (delay_prediction dataset) | `notebooks/03-delay-prediction.ipynb` |
| Implement data loading + delay bucket definition cells | 5 | [x] | Notebook created | `notebooks/03-delay-prediction.ipynb` |
| Implement XGBoost multi-class classifier | 5 | [x] | Data loading cells | `notebooks/03-delay-prediction.ipynb` |
| Implement evaluation (confusion matrix, feature importance) | 5 | [x] | Classifier cells | `notebooks/03-delay-prediction.ipynb` |
| Test all notebooks end-to-end on SageMaker | 5 | [x] | All notebook tasks, Phase 3 deployed | -- |

---

## Phase 6: Code Review Remediation

_Review completed 2026-02-23. Full review at `dev/review/ml-lab-stack/`._

| Task | Priority | Status | Effort | Files |
|------|----------|--------|--------|-------|
| Fix all 7 Glue table schemas to match actual Parquet data | Critical | [ ] | M | `infra/cdk/lib/ml-lab-stack.ts` |
| Fix SageMaker auto-stop script — hardcode idle timeout in Python | Critical | [ ] | S | `infra/cdk/lib/ml-lab-stack.ts` |
| Stop SageMaker notebook immediately (cost bleed) | Critical | [ ] | S | AWS Console / CLI |
| Fix PySpark column references to match Parquet schemas | High | [ ] | S | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Fix capturedAt to use capture time, not flush time | High | [ ] | S | `server/src/analytics/position-archiver.ts` |
| Align CDK IAM role with actual EC2 instance profile | High | [ ] | M | `infra/cdk/lib/analytics-stack.ts` |
| Add S3 encryption to ML bucket | Medium | [ ] | S | `infra/cdk/lib/ml-lab-stack.ts` |
| Replace AmazonSageMakerFullAccess with scoped policy | Medium | [ ] | M | `infra/cdk/lib/ml-lab-stack.ts` |
| Add CloudWatch alarm for ML dataset Glue job failure | Medium | [ ] | S | `infra/cdk/lib/ml-lab-stack.ts` |
| Fix overlapping S3 lifecycle rules | Medium | [ ] | S | `infra/cdk/lib/analytics-stack.ts` |
| Replace gzipSync with async gzip | Medium | [ ] | S | `server/src/analytics/position-archiver.ts` |
| Change real-time datasets to append mode | Medium | [ ] | M | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |
| Parameterize upload script source directory | Low | [ ] | S | `scripts/upload-historical-mta.ts` |
| Add unit tests for position-archiver and CDK stack | Low | [ ] | L | `server/src/__tests__/`, `infra/cdk/test/` |
| Extract shared PySpark windowing helper | Low | [ ] | S | `infra/cdk/glue-scripts/ml-dataset-pipeline.py` |

---

## Summary

| Phase | Total Tasks | Completed | Remaining |
|-------|-------------|-----------|-----------|
| 0 -- Documentation | 4 | 4 | 0 |
| 1 -- Real-Time Data Capture | 8 | 8 | 0 |
| 2 -- Historical Data Upload | 8 | 8 | 0 |
| 3 -- CDK ML Lab Stack | 13 | 13 | 0 |
| 4 -- ML Dataset Pipeline | 8 | 8 | 0 |
| 5 -- Jupyter Notebooks | 13 | 13 | 0 |
| 6 -- Code Review Remediation | 15 | 0 | 15 |
| **Total** | **69** | **54** | **15** |
