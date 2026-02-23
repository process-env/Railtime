# Observability Context

## Current State (Post-Implementation)

### Structured Logging
- **Library:** pino 9.x with pino-pretty 13.x (dev only)
- **Logger module:** `server/src/lib/logger.ts`
- **Pattern:** `createLogger('module-name')` creates a child logger
- **Production output:** JSON (Docker JSON log driver → CloudWatch Logs)
- **Dev output:** pino-pretty (colorized, human-readable)
- **Control:** `LOG_LEVEL` env var (default: `info`)

### Files Migrated (15 total)
| File | Logger Name | Console Calls Replaced |
|------|-------------|----------------------|
| `server/src/index.ts` | `server` | 13 |
| `server/src/ingestion/feed-loop.ts` | `feed-loop` | 11 |
| `server/src/ingestion/alert-loop.ts` | `alert-loop` | 7 |
| `server/src/namespaces/trains.ts` | `ns:trains` | 7 |
| `server/src/namespaces/alerts.ts` | `ns:alerts` | 6 |
| `server/src/namespaces/arrivals.ts` | `ns:arrivals` | 4 |
| `server/src/analytics/metrics-collector.ts` | `metrics` | 14 |
| `server/src/analytics/transit-analyzer.ts` | `analyzer` | 3 |
| `server/src/analytics/dynamodb-writer.ts` | `dynamo-writer` | 1 |
| `server/src/analytics/schedule-lookup.ts` | `schedule` | 8 |
| `server/src/lib/redis.ts` | `redis` | 2 |
| `server/src/lib/neo4j.ts` | `neo4j` | 3 |
| `server/src/lib/dynamodb.ts` | `dynamodb` | 3 |
| `server/src/lib/cache.ts` | `cache` | 1 |
| `server/src/api/transit-analysis.ts` | `api:analysis` | 1 |

### CloudWatch Alarms (CDK)

5 alarms defined in `infra/cdk/lib/analytics-stack.ts`:

| Alarm Name | Metric | Period | Threshold | Rationale |
|------------|--------|--------|-----------|-----------|
| `railtime-stream-to-s3-errors` | Lambda errors | 5 min | ≥ 1 | DynamoDB records not reaching S3 — data loss risk |
| `railtime-stream-to-s3-duration` | Lambda max duration | 5 min | ≥ 240s | 80% of 5-min timeout — batch size growing |
| `railtime-glue-trigger-errors` | Lambda errors | 5 min | ≥ 1 | Daily ETL won't run — rollups stale |
| `railtime-metrics-write-throttles` | DynamoDB PutItem throttles | 5 min | ≥ 1 | Hot partition — should never happen with on-demand |
| `railtime-glue-job-failure` | Glue failed tasks | 1 hr | ≥ 1 | ETL job failed — check Glue logs |

### k6 Load Tests

Script: `server/load-tests/ws-load-test.js`

| Scenario | VUs | Duration | Start Time |
|----------|-----|----------|------------|
| `connection_ramp` | 0 → 200 | 6 min | 0:00 |
| `sustained` | 100 | 5 min | 7:00 |
| `spike` | 100 → 500 | 3 min | 13:00 |

Custom metrics: `ws_connection_time`, `ws_messages_received`, `ws_message_latency`, `ws_connection_success`

## Not Implemented (Future Work)

- **OpenTelemetry:** Distributed tracing with spans — would add trace-id correlation across feed-loop → Redis → Socket.IO → client. Significant complexity for solo-dev.
- **Grafana:** Dashboard visualization of CloudWatch metrics. CloudWatch Logs Insights serves the same purpose with less infra.
- **PagerDuty/OpsGenie:** Escalation policies. SNS email is sufficient for now.
- **Custom CloudWatch Metrics:** Publish pino log data as CloudWatch custom metrics for graphing. Would require a CloudWatch agent or Log Metric Filter.
