# Railtime

Real-time NYC subway tracker with AI-powered transit analytics, event-driven observability, and graph-based trip planning.

**Live:** [traintracker-kappa.vercel.app](https://traintracker-kappa.vercel.app)

![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript) ![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-5-396CB2?logo=maplibre-gl) ![Socket.IO 4](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io) ![Neo4j 5](https://img.shields.io/badge/Neo4j-5-008CC1?logo=neo4j) ![Redis 7](https://img.shields.io/badge/Redis-7-DC382D?logo=redis) ![AWS CDK](https://img.shields.io/badge/AWS_CDK-2-FF9900?logo=amazonaws) ![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss)

---

## System Architecture

Two-package monorepo split by runtime constraint: Vercel's serverless model terminates functions after execution -- WebSocket long connections and persistent feed-polling loops require a process that stays alive. The WS server runs on EC2 where a Node.js process can hold 8 concurrent feed connections and maintain Socket.IO sessions indefinitely.

```
 Vercel (Serverless)                          EC2 t3.small (Persistent)
 ┌───────────────────────────┐                ┌──────────────────────────────────────────────┐
 │  Next.js 16 App Router    │                │  Docker Compose (4 services)                 │
 │                           │  Socket.IO     │  ┌────────────────────────────────────┐      │
 │  React 19 + MapLibre GL   │◄══════════════►│  │  WS Server (Node.js, 512MB)        │      │
 │  React Query + Zustand    │  /trains       │  │   ├── feed-loop (8 feeds, 15s)     │      │
 │                           │  /alerts       │  │   ├── alert-loop                   │      │
 │  Prisma (PostgreSQL)      │  /arrivals     │  │   ├── arrival-loop                 │      │
 │                           │                │  │   ├── metrics-collector (5-min)    │      │
 │  Trip API (Neo4j/Dijkstra │                │  │   └── transit-analyzer (Bedrock)   │      │
 │           fallback)       │                │  └─────────┬────────────┬─────────────┘      │
 └───────────────────────────┘                │            │            │                    │
                                              │  ┌─────────▼──┐  ┌─────▼──────┐  ┌─────────┐ │
                                              │  │ Neo4j 5    │  │ Redis 7    │  │ nginx   │ │
                                              │  │ 768MB      │  │ 300MB      │  │ SSL/rev │ │
                                              │  └────────────┘  └────────────┘  └─────────┘ │
                                              └──────────────────────────────────────────────┘
                                                        │
                                              ┌─────────▼──────────────────────────────────────┐
                                              │  AWS Analytics Pipeline                        │
                                              │  DynamoDB (3 tables) ─► Streams ─► Lambda      │
                                              │       │                             ─► S3      │
                                              │  EventBridge (01:00 UTC) ─► Lambda ─► Glue ETL │
                                              │       │                    ─► S3 Parquet       │
                                              │       └──► DynamoDB rollups                    │
                                              │  AppSync GraphQL ◄── DynamoDB                  │
                                              │  Bedrock (Sonnet 4) ─► Redis cache             │
                                              └────────────────────────────────────────────────┘
```

---

## AWS Service Architecture

The analytics pipeline is deployed as a single CDK `AnalyticsStack` producing ~26 CloudFormation resources. Every service choice was driven by operational simplicity on a solo-dev budget: pay-per-request pricing, zero capacity planning, and graceful degradation when any component is unreachable.

### DynamoDB (3 Tables)

| Table | PK | SK | TTL | Streams | Purpose |
|-------|----|----|-----|---------|---------|
| `railtime-metrics` | `routeId` (S) | `timestamp` (N) | `expireAt` (7d) | NEW_IMAGE | Per-route snapshots every 5 min: train count, avg delay, on-time %, headway, feed latency/status |
| `railtime-events` | `pk` (S) | `timestamp` (N) | `expireAt` (7d) | NEW_IMAGE | Lifecycle + anomaly events: TRIP_START, TRIP_END, DELAY, BUNCH, GAP, ALERT |
| `railtime-rollups` | `routeId` (S) | `date` (S) | None | None | Permanent daily aggregates: direction-aware, computed in-process + Glue ETL |

**Design rationale:**

- **Composite sort keys encode direction** -- `date` SK uses `"2026-02-22#N"` format so a single Query retrieves direction-filtered rollups without a GSI.
- **PAY_PER_REQUEST billing** -- the write pattern is bursty (batch flush every 5 min, then silence). Provisioned capacity would either waste money during gaps or throttle during flushes.
- **TTL auto-expires raw data** (7 days) but rollups have no TTL -- raw metrics are high-volume ephemeral signals; rollups are permanent analytical records.
- **Batch writes (25/batch)** with exponential backoff retry (3 retries, 200ms/400ms/800ms) handle unprocessed items without dropping data.
- **SYSTEM_HEALTH composite record** -- a special `routeId="SYSTEM_HEALTH"` metric aggregates all routes with a JSON `feedGroupData` attribute containing per-feed-group breakdown (train count, latency, status). Single-item read for dashboard health check.
- **Event PK design** -- `"DELAY#A#N"`, `"BUNCH#Q#S"`, `"GAP#7#N"` -- encodes event type + route + direction in the partition key. Same-PK events are sorted by timestamp for efficient time-range queries.

### Amazon Bedrock (AI Transit Analysis)

- **Model:** Claude Sonnet 4 (`us.anthropic.claude-sonnet-4-20250514-v1:0`)
- **Architecture:** Async fire-and-forget -- `generateAnalysis()` is called after each 5-min flush; errors are caught and logged but never block the metrics pipeline. If Bedrock is unreachable, the flush cycle is unaffected.
- **Prompt engineering:** Pre-computes derived signals (direction imbalances >1.5x, cascading anomalies per route, ahead-of-schedule routes) before calling the model. Instructs the model to find NON-OBVIOUS patterns only -- the dashboard already displays raw metrics.
- **Parameters:** Temperature 0.3, max_tokens 1024 -- low temperature for consistent analytical output across flushes.
- **Caching:** Result stored in Redis with 600s TTL (2x the 5-min flush interval for safety overlap). Served via `GET /api/transit-analysis` on the WS server.

### S3 (Data Lake)

- **Bucket:** `railtime-analytics-{accountId}`, BLOCK_ALL public access
- **Partitioned NDJSON:**
  - Metrics: `raw/metrics/year={Y}/month={M}/day={D}/hour={H}/{ts}-{uuid}.ndjson`
  - Events: `raw/events/year={Y}/month={M}/day={D}/{ts}-{uuid}.ndjson`
- **Lifecycle:** Standard -> Infrequent Access at 30 days, expire at 365 days. Raw data doesn't need sub-millisecond access after the first month, and 365-day expiry bounds storage costs.
- **Also stores:** Glue PySpark scripts (`glue-scripts/`) and Parquet rollup output (`rollups/daily/`)

### Lambda (2 Functions)

| Function | Trigger | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| `railtime-stream-to-s3` | DynamoDB Streams (metrics + events) | 256MB | 5 min | Classifies records, writes partitioned NDJSON to S3. Batch size 100, max batching window 5 min. Re-throws on failure for Lambda retry. |
| `railtime-glue-trigger` | EventBridge daily 01:00 UTC | 128MB | 30s | Starts the Glue ETL job. IAM scoped to `glue:StartJobRun` on the specific job ARN only. |

**Why Lambda for stream-to-S3 instead of Kinesis Firehose?** DynamoDB Streams trigger Lambda natively -- no additional service to configure. The volume (~500-1000 records/day) doesn't justify Firehose's minimum 60s buffer and separate billing. Lambda's 5-min batching window naturally coalesces records into reasonably-sized NDJSON files.

### Glue (PySpark ETL)

- **Database:** `railtime_analytics` (Data Catalog)
- **Crawler:** `railtime-raw-crawler`, daily at 00:30 UTC, crawls `raw/metrics/` and `raw/events/` S3 prefixes
- **ETL Job:** `railtime-daily-rollup`, Glue 4.0, PySpark, maxCapacity 2
  1. Reads yesterday's raw NDJSON from S3
  2. Computes per-route aggregates (avg delay, on-time %, peak trains, avg headway)
  3. Joins with alert event counts
  4. Writes to DynamoDB rollups table (batch_writer)
  5. Also writes Parquet to `rollups/daily/year={Y}/month={M}/{date}.parquet` for historical analysis

**Why maxCapacity 2?** The dataset is small (a few hundred MB of NDJSON per day). Two DPUs are the minimum for a PySpark job and complete the ETL in minutes. No autoscaling needed.

### AppSync (GraphQL API)

- **API:** `RailtimeAnalyticsAPI`, API Key auth (365-day expiry)
- **Data Sources:** DynamoDB direct (metrics, rollups, events tables)
- **VTL Resolvers:**

| Query | Data Source | Description |
|-------|-------------|-------------|
| `getRouteMetrics(routeId, direction?, from, to)` | metrics | Time-range query on 5-min snapshots |
| `getDailyRollups(routeId?, direction?, from, to)` | rollups | Date-range query on daily aggregates |
| `getLatestSystemHealth` | metrics | Latest SYSTEM_HEALTH record |
| `getTripEvents(routeId, direction?, from, to, eventType?)` | events | Event stream with optional type filter |

- **Subscription:** `onRouteMetricUpdate(routeId?)` via None data source (local resolver) -- enables real-time metric push via AppSync WebSocket without polling.

**Why AppSync over a custom GraphQL server?** The resolvers are pure data access (DynamoDB Query with VTL templates). No business logic, no joins, no computed fields. AppSync eliminates server management for read-only analytics queries and provides built-in subscription support.

### EventBridge

- `railtime-daily-rollup-trigger`: `cron(0 1 * * ? *)` -- triggers Glue ETL at 01:00 UTC daily
- Raw crawler runs at 00:30 UTC (Glue native schedule) -- 30 minutes before ETL so the Data Catalog is updated when the job reads

### CDK (Infrastructure as Code)

Single `AnalyticsStack` TypeScript class in `infra/cdk/lib/analytics-stack.ts`. Key constructs:

| Count | Resource Type |
|-------|---------------|
| 3 | DynamoDB tables |
| 1 | S3 bucket + lifecycle rules |
| 2 | Lambda functions (`NodejsFunction` with esbuild bundling) |
| 1 | Glue database + crawler + ETL job |
| 1 | AppSync API + 5 resolvers (4 Query + 1 Mutation) |
| 1 | EventBridge rule |
| 6 | IAM roles |
| 1 | S3 BucketDeployment (Glue scripts) |

### IAM (Least Privilege)

6 distinct roles, each scoped to minimum required permissions:

| Role | Permissions | Scope |
|------|-------------|-------|
| stream-to-s3 Lambda | `s3:PutObject` | Analytics bucket only |
| glue-trigger Lambda | `glue:StartJobRun` | Specific job ARN only |
| Glue ETL | AWSGlueServiceRole + S3 ReadWrite + DynamoDB Write | Analytics bucket + rollups table |
| Crawler | AWSGlueServiceRole + S3 Read | Analytics bucket (read-only) |
| WS Server | DynamoDB Write | All 3 analytics tables (EC2 instance profile) |
| AppSync | Auto-generated per data source | DynamoDB Read |

EC2 instance profile for the WS server -- NO hardcoded credentials. The production Docker Compose explicitly warns: _"Do NOT set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY -- blocks SDK metadata fallback"_.

---

## Real-Time Data Pipeline

```
MTA GTFS-RT Protobuf (8 feeds)
         │
         │  15s parallel fetch (axios, 15s timeout)
         ▼
┌─────────────────────────────────────────────────────────┐
│  Feed Loop (server/src/ingestion/feed-loop.ts)          │
│                                                         │
│  protobufjs decode ─► entity extraction ─► position     │
│  interpolation (linear between stops + heading calc)    │
│                                                         │
│  Output per feed group:                                 │
│    trains[]: tripId, routeId, lat, lon, heading,        │
│              nextStopId, eta, headsign                   │
│    entities[]: raw GTFS-RT for arrival computation       │
│    removedTripIds[]: trains that vanished (trip ended)   │
└────────┬──────────────┬───────────────┬─────────────────┘
         │              │               │
         ▼              ▼               ▼
   Redis cache    Socket.IO        Metrics Collector
   (30s TTL)      broadcast        (5-min buffer)
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    /trains        /alerts      /arrivals
    (room per      (broadcast   (per-station
    feed group)    on change)    rooms)
```

**8 feed groups:** ACE, BDFM, G, JZ, NQRW, L, SI, 1234567 -- matching MTA's GTFS-RT feed structure. Each group is fetched in parallel every 15 seconds.

**Position interpolation:** For each trip with 2+ stop updates, the algorithm finds the two stops the train is currently between (based on arrival timestamps), computes linear progress between their coordinates, and calculates a heading via the atan2 bearing formula. This produces smooth map positions even though the MTA only provides discrete stop-level data.

**Redis caching:** Positions and raw entities are cached with 30s TTL (slightly longer than the 15s poll interval for overlap). This serves two purposes: (1) arrivals namespace can read entities without re-fetching, (2) if a feed poll fails, the previous cycle's data remains valid for one extra interval.

**Socket.IO namespaces:**

| Namespace | Fan-out Model | Purpose |
|-----------|---------------|---------|
| `/trains` | Room per feed group | Position updates -- clients join rooms for their visible routes |
| `/alerts` | Broadcast on change | MTA service alerts |
| `/arrivals` | Room per station | Per-station arrival boards computed from raw entities |

**Redis adapter** enables horizontal scaling -- multiple WS server instances share pub/sub channels so a broadcast from one instance reaches clients on all instances.

**Dual-mode delivery:** If `NEXT_PUBLIC_WS_URL` is set, the frontend uses Socket.IO push (near-instant updates). Otherwise, React Query HTTP polling at 15s intervals serves as a full-fidelity fallback.

---

## Analytics Pipeline

```
Feed Loop (15s)
      │
      ▼
Metrics Collector (5-min in-memory buffer)
      │
      ├──► DynamoDB metrics    (per-route: trainCount, delay, on-time%, headway, latency)
      ├──► DynamoDB events     (TRIP_START, TRIP_END, DELAY, BUNCH, GAP, ALERT)
      ├──► DynamoDB rollups    (daily: direction-aware aggregates, reservoir-sampled median)
      ├──► Bedrock analysis    (async fire-and-forget ─► Redis 600s cache)
      └──► Trip lifecycle      (30-min stale cleanup ─► auto TRIP_END)

DynamoDB Streams ──► Lambda (stream-to-s3) ──► S3 NDJSON (partitioned by date/hour)

EventBridge (01:00 UTC) ──► Lambda (glue-trigger) ──► Glue ETL (PySpark)
                                                          ├──► DynamoDB rollups
                                                          └──► S3 Parquet (historical)

AppSync GraphQL ◄── DynamoDB (metrics, rollups, events)
```

**Key design decisions:**

- **Reservoir sampling (size 1000)** for median headway computation. A naive approach would store all headway observations in an array, but headway data accumulates ~500 samples/flush across 26 routes x 2 directions. Reservoir sampling provides an unbiased median estimate in O(1) memory per route regardless of sample count.
- **Running counters for mean/on-time%** -- `sumDelays / countDelays` instead of unbounded arrays. The buffer is cleared every 5 minutes, but the daily accumulator tracks sums over the full 24-hour window.
- **Direction-aware metrics** -- every metric is tracked per `routeId#direction` (N/S). The `#` separator in composite keys lets a single DynamoDB partition hold both directions while remaining Query-friendly.
- **Bunching detection** (<2 min headway between successive trains at the same stop), **gap detection** (>15 min headway), **skipped stop detection** (GTFS `scheduleRelationship: SKIPPED`).
- **30-minute stale trip cleanup** -- if a train hasn't been seen for 30 minutes, the collector auto-generates a TRIP_END event (marked `stale: true`). This handles trains that vanish from the feed without a clean end-of-trip signal.
- **Graceful degradation** -- all collector functions check `getDynamoClient()` and return immediately if DynamoDB is not configured. The feed loop, Socket.IO broadcast, and Redis caching continue unaffected.

---

## Trip Planning Engine

Two implementations with automatic fallback. The API route (`/api/v1/trip`) tries Neo4j first; if `NEO4J_URI` is unset or the query fails, it falls back to the in-memory Dijkstra.

### Neo4j Cypher (Primary)

```cypher
MATCH (o:StationRoute) WHERE o.stationId = $originId
MATCH (d:StationRoute) WHERE d.stationId = $destId
MATCH path = shortestPath((o)-[:CONNECTS_TO*..50]->(d))
```

**Graph model:**
```
(:StationRoute {key, stationId, routeId})
    -[:CONNECTS_TO {duration, type, routeId, complexId, walkTime}]->
(:StationRoute)

(:Station {id, name, lat, lon})
```

- **Over-fetches 4x** then deduplicates by route combination -- different `(origin StationRoute, dest StationRoute)` pairs surface genuinely different trips (e.g. A vs C from the same station complex).
- **Route avoidance:** WHERE ALL clause filters edges whose `routeId` is in `$avoidRoutes` list.
- **Max transfer limit** via post-filter on `transferCount`.
- **Connection pool:** max 50, acquisition timeout 10s, connection timeout 5s.

### In-Memory Dijkstra (Fallback)

Custom binary-heap priority queue over a pre-built transit graph.

- **Graph model:** `(stationId, routeId)` pairs as nodes, "ride" + "transfer" edges
- **Edge costs:** travel time (from duration matrix) + transfer penalty (5 min default) + out-of-system penalty (1 min extra for walking between station complexes)
- **k-shortest paths** via modified Yen's algorithm -- avoids routes from previous solutions to produce genuinely different alternatives
- **Pre-built JSON from `public/data/`:** transfer-graph, route-segments, station-routes, **duration-matrix (6MB gzipped)** generated at build time from GTFS static schedules (`scripts/build-duration-matrix.ts`)

---

## Graceful Degradation Matrix

Every external dependency has a fallback path. The system operates at reduced fidelity rather than failing.

| Feature | Primary | Fallback | Trigger |
|---------|---------|----------|---------|
| Train positions | Socket.IO push | React Query polling (15s) | `NEXT_PUBLIC_WS_URL` unset |
| Service alerts | Socket.IO push | React Query polling | `NEXT_PUBLIC_WS_URL` unset |
| Arrival boards | Socket.IO (per-station rooms) | React Query polling | `NEXT_PUBLIC_WS_URL` unset |
| Trip planning | Neo4j Cypher shortest path | In-memory Dijkstra | `NEO4J_URI` unset |
| Data caching | Redis (30s TTL, allkeys-lru) | Direct fetch (no cache) | `REDIS_URL` unset |
| Analytics | DynamoDB + S3 + Glue pipeline | Disabled (no-op functions) | DynamoDB not configured |
| AI insights | Bedrock Claude Sonnet 4 | Analysis unavailable | Bedrock unreachable |
| Socket.IO scaling | Redis adapter (pub/sub) | Single-instance mode | Redis unavailable |

---

## Infrastructure

### Production (EC2 t3.small, 2GB RAM)

```
┌──────────────────────────────────────────────────────┐
│  Docker Compose (infra/docker-compose.prod.yml)      │
│                                                      │
│  neo4j:5-community  ── 768MB limit                   │
│    256MB heap, 128MB page cache                      │
│    healthcheck: cypher-shell RETURN 1                │
│                                                      │
│  redis:7-alpine  ── 300MB limit                      │
│    256MB maxmemory, allkeys-lru, AOF persistence     │
│    password auth                                     │
│                                                      │
│  ws-server (Node.js)  ── 512MB limit                 │
│    depends_on: neo4j (healthy) + redis (healthy)     │
│    GTFS data: mounted volume (read-only)             │
│    AWS creds: EC2 instance profile (no env vars)     │
│                                                      │
│  nginx:alpine  ── reverse proxy, SSL termination     │
│                                                      │
│  Total: ~1.6GB / 2GB = 80% utilization with headroom │
└──────────────────────────────────────────────────────┘
```

### CI/CD

**GitHub Actions** (`.github/workflows/ci.yml`): 3 parallel jobs

| Job | Steps |
|-----|-------|
| Next.js App | `npm ci` -> `eslint` -> `tsc --noEmit` -> `vitest run` |
| WS Server | `npm ci` -> `tsc --noEmit` -> `npm run build` |
| Docker Build | `docker build -t railtime-ws-server ./server` |

**Deployment:** `vercel --prod --yes` after git push. GitHub Actions runs checks independently -- it does NOT trigger Vercel deployment. 44 test files, 662 tests (Vitest).

---

## Performance & Cost

### Latency Budget

| Stage | Typical | Notes |
|-------|---------|-------|
| MTA feed fetch + protobuf decode | <2s per feed | 8 feeds fetched in parallel |
| Position interpolation | <50ms | Linear interp + heading calc per entity |
| Socket.IO broadcast | <10ms | Room-based fan-out, Redis adapter pub/sub |
| Analytics flush (DynamoDB batch) | <500ms | 25-item batches with backoff |
| Bedrock analysis generation | 3-5s | Async, cached 10 min |
| Glue daily ETL | ~5 min | Runs once at 01:00 UTC |

### Cost Optimization

| Service | Strategy | Impact |
|---------|----------|--------|
| DynamoDB | PAY_PER_REQUEST | Scales to zero during off-hours, no provisioned capacity waste |
| S3 | Standard -> IA at 30d, expire at 365d | Raw data doesn't need fast access after a month |
| Glue ETL | maxCapacity 2, once daily | Minimal compute -- 2 DPUs for a few minutes |
| Lambda | Event-driven, pay per invocation | Zero cost when no data flows |
| EC2 | t3.small burstable | ~$15/mo for the persistent WS server |
| Redis | allkeys-lru, 256MB max | Bounded memory regardless of data volume |

---

## Observability

### Structured Logging (pino)

All 15 server modules use [pino](https://github.com/pinojs/pino) with child loggers per module. JSON in production (CloudWatch Logs searchable), pino-pretty in development.

```
LOG_LEVEL=info (default) | trace | debug | info | warn | error | fatal
```

**Log output in production** (Docker JSON log driver → CloudWatch Logs):
```json
{"level":30,"time":"2026-02-22T03:15:00.000Z","module":"feed-loop","trains":342,"feeds":8,"failed":0,"msg":"cycle complete"}
```

**Module loggers:**

| Logger Name | Module | Key Structured Fields |
|-------------|--------|----------------------|
| `server` | `index.ts` | `port`, `signal`, `socketId` |
| `feed-loop` | `ingestion/feed-loop.ts` | `trains`, `feeds`, `failed`, `feedGroupId`, `stops` |
| `alert-loop` | `ingestion/alert-loop.ts` | `total`, `new`, `cleared` |
| `ns:trains` | `namespaces/trains.ts` | `socketId`, `room`, `reason` |
| `ns:alerts` | `namespaces/alerts.ts` | `socketId`, `room`, `reason` |
| `ns:arrivals` | `namespaces/arrivals.ts` | `socketId`, `room`, `reason` |
| `metrics` | `analytics/metrics-collector.ts` | `metricsCount`, `eventsCount`, `anomalies`, `rollupsCount` |
| `analyzer` | `analytics/transit-analyzer.ts` | `model`, `charCount` |
| `dynamo-writer` | `analytics/dynamodb-writer.ts` | `table`, `unprocessed`, `retries` |
| `schedule` | `analytics/schedule-lookup.ts` | `serviceId`, `prefixes`, `stopTimes` |
| `redis` | `lib/redis.ts` | `client` (main/pub/sub) |
| `neo4j` | `lib/neo4j.ts` | -- |
| `dynamodb` | `lib/dynamodb.ts` | -- |
| `cache` | `lib/cache.ts` | `key` |
| `api:analysis` | `api/transit-analysis.ts` | -- |

### CloudWatch Alarms (Pipeline Alerting)

5 alarms → SNS topic (`railtime-pipeline-alerts`) → email subscription.

| Alarm | Metric | Threshold | Why |
|-------|--------|-----------|-----|
| `railtime-stream-to-s3-errors` | Lambda errors (5 min) | ≥ 1 | DynamoDB records not reaching S3 |
| `railtime-stream-to-s3-duration` | Lambda max duration (5 min) | ≥ 240s | Approaching 5-min timeout — batch too large |
| `railtime-glue-trigger-errors` | Lambda errors (5 min) | ≥ 1 | Daily ETL will not run |
| `railtime-metrics-write-throttles` | DynamoDB PutItem throttles (5 min) | ≥ 1 | Hot partition (should be 0 with on-demand) |
| `railtime-glue-job-failure` | Glue failed tasks (1 hr) | ≥ 1 | Daily rollup job has failed tasks |

All alarms use `treatMissingData: NOT_BREACHING` — no alerts when the pipeline is idle. Post-deploy subscription:

```bash
aws sns subscribe --topic-arn <AlertTopicArn> --protocol email --notification-endpoint you@example.com
```

### What's Not Monitored (Future Work)

- **OpenTelemetry distributed tracing** — too heavy for solo-dev. Structured logging + CloudWatch covers ~90% of observability needs.
- **Grafana dashboards** — CloudWatch Logs Insights queries serve the same purpose at lower operational cost.
- **APM (Application Performance Monitoring)** — pino structured fields + k6 baselines provide the same signal without a vendor dependency.

---

## Load Testing

### Methodology

[k6](https://k6.io/) with the `k6/websockets` module (browser-compatible WebSocket API), testing against the Socket.IO server's `/trains` namespace. Direct WebSocket transport (no long-polling handshake) using the Engine.IO 4 + Socket.IO 4 wire protocol. Each virtual user (VU) performs the full connection handshake, namespace connection, and room subscription.

**3 scenarios run sequentially (~14 min total):**

| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| Connection ramp | 0 → 200 | 6 min | Find connection ceiling |
| Sustained | 100 | 5 min | Steady-state performance |
| Spike | 100 → 500 | 3 min | Burst capacity |

**Custom metrics tracked:**

| Metric | Type | Threshold |
|--------|------|-----------|
| `ws_connection_time` | Trend (ms) | P95 < 5s |
| `ws_connection_success` | Rate | > 99% |
| `ws_messages_received` | Counter | > 0 |
| `ws_message_latency` | Trend (ms) | -- |

### Production Results (EC2 t3.small)

Tested against production on EC2 t3.small (2 vCPU, 2GB RAM) with WS server container at 512MB memory limit, Redis 7 (256MB), and Neo4j 5 (768MB) -- all services on a single instance via Docker Compose.

**All 3 scenarios passed all thresholds.**

| Scenario | VUs | Duration | Result |
|----------|-----|----------|--------|
| Connection Ramp | 0 → 200 | 6 min | 3/3 thresholds passed |
| Sustained | 100 | 5 min | 3/3 thresholds passed |
| Spike | 100 → 500 | 3 min | 3/3 thresholds passed |

**Key metrics:**

| Metric | Value |
|--------|-------|
| Connection success rate | 100% (3,882/3,882) |
| Connection time (P50) | 13ms |
| Connection time (P95) | 4.67s |
| Total messages received | 263,058 |
| Message throughput | 270 msgs/s |
| Data transferred | 780 MB received |
| Total iterations | 3,703 complete + 179 interrupted (ramp-down) |

### Bottleneck Analysis

1. **At 200 VUs:** P50 connection time is 6ms -- the server is comfortable at this concurrency level.
2. **At 500 VUs (spike):** P95 connection time stretches to 4.67s -- approaching the 5s threshold. The t3.small starts to strain at 500 concurrent WebSocket connections.
3. **CPU is the bottleneck:** 2 vCPU handling 500 connections + 8 MTA feed fetches every 15s + broadcasting to all rooms. This is where the t3.small hits its ceiling.
4. **Memory stayed within limits:** The 512MB WS server container limit held throughout all scenarios, including the 500-VU spike.

### Running

```bash
# On the EC2 instance (k6 must be installed)
k6 run /opt/railtime/server/load-tests/ws-load-test.js

# Smoke test (1 VU, 30s)
k6 run --vus 1 --duration 30s --no-thresholds /opt/railtime/server/load-tests/ws-load-test.js
```

---

## Data Model

### DynamoDB Schemas

**railtime-metrics**
| Attribute | Type | Description |
|-----------|------|-------------|
| `routeId` (PK) | S | `"A#N"`, `"7#S"`, or `"SYSTEM_HEALTH"` |
| `timestamp` (SK) | N | Epoch ms |
| `trainCount` | N | Active trains in this direction |
| `avgDelaySeconds` | N | Mean schedule deviation (signed, seconds) |
| `onTimePercent` | N | % of stops within 5 min of schedule |
| `headwayAvgSeconds` | N | Mean headway between successive trains |
| `feedLatencyMs` | N | Feed fetch + decode time |
| `feedStatus` | S | `"success"`, `"error"`, `"timeout"` |
| `feedGroupData` | S | JSON (SYSTEM_HEALTH only): per-feed-group breakdown |
| `alertCount` | N | Active alerts (SYSTEM_HEALTH only) |
| `expireAt` | N | TTL epoch seconds (now + 7 days) |

**railtime-events**
| Attribute | Type | Description |
|-----------|------|-------------|
| `pk` (PK) | S | `"TRIP_START#A#N"`, `"DELAY#Q#S"`, `"BUNCH#7#N"`, `"GAP#L#S"`, `"ALERT#G"` |
| `timestamp` (SK) | N | Epoch ms |
| `tripId` | S | GTFS trip ID (lifecycle events) |
| `delaySeconds` | N | Max delay observed (DELAY events) |
| `description` | S | JSON payload (TRIP_END) or text (BUNCH/GAP) |
| `alertId` | S | MTA alert ID (ALERT events) |
| `severity` | S | Alert severity |
| `expireAt` | N | TTL epoch seconds |

**railtime-rollups**
| Attribute | Type | Description |
|-----------|------|-------------|
| `routeId` (PK) | S | `"A"`, `"7"`, etc. |
| `date` (SK) | S | `"2026-02-22#N"` (direction encoded in SK) |
| `avgDelay` | N | Day's mean delay (seconds) |
| `onTimePercent` | N | Day's on-time % |
| `peakTrainCount` | N | Max concurrent trains |
| `avgHeadway` | N | Mean headway (seconds) |
| `medianHeadway` | N | Reservoir-sampled median headway |
| `totalBunching` | N | Bunching incidents (<2 min headway) |
| `totalGaps` | N | Service gaps (>15 min headway) |
| `totalSkippedStops` | N | GTFS SKIPPED stop updates |
| `totalTrips` | N | Cumulative train count |
| `totalAlerts` | N | Unique alert count |

### PostgreSQL (Prisma)

| Model | Key Fields |
|-------|------------|
| `Station` | id, name, lat, lon, locationType, parentId (self-ref), routeIds[] |
| `Route` | id, shortName, longName, type, color, textColor, feedGroupId |

### Neo4j Graph

```
(:StationRoute {key, stationId, routeId})
    -[:CONNECTS_TO {duration, type, routeId, complexId, walkTime}]->
(:StationRoute)

(:Station {id, name, lat, lon})
```

One `StationRoute` node per (station, route) pair. `CONNECTS_TO` edges are typed as `"ride"` (between stops on the same route) or `"transfer"` (between routes at a station complex, with optional `walkTime` for out-of-system transfers).

### Redis Keys

| Key | TTL | Content |
|-----|-----|---------|
| `feed:{groupId}:positions` | 30s | Cached train positions array |
| `feed:{groupId}:entities` | 30s | Raw GTFS entities for arrival computation |
| `transit-analysis:latest` | 600s | Bedrock AI analysis result |

---

## Getting Started

### Development (Minimal)

```bash
git clone <repo>
npm install
npm run dev          # Next.js on :3000, React Query polling mode
```

This runs the frontend only with HTTP polling fallback. No databases required.

### Full Stack (WS Server + Databases)

```bash
docker compose -f docker-compose.v2.yml --env-file .env.v2 up -d   # Neo4j + Redis
cd server && npm install && npm run dev                              # WS server on :3001
npm run dev                                                          # Next.js on :3000
```

### Production

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.v2 up -d
npm run build && vercel --prod --yes
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Prisma) |
| `MTA_API_KEY` | No | MTA API key (works without, but recommended) |
| `NEXT_PUBLIC_WS_URL` | No | WS server URL -- enables Socket.IO push mode |
| `REDIS_URL` | No | Redis connection URL -- enables caching + Socket.IO adapter |
| `NEO4J_URI` | No | Neo4j bolt:// URI -- enables graph trip planning |
| `NEO4J_USER` | No | Neo4j username (default: neo4j) |
| `NEO4J_PASSWORD` | No | Neo4j password |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins for WS server |
| `AWS_REGION` | No | AWS region (default: us-east-1) |
| `DYNAMODB_TABLE_METRICS` | No | DynamoDB metrics table name |
| `DYNAMODB_TABLE_EVENTS` | No | DynamoDB events table name |
| `DYNAMODB_TABLE_ROLLUPS` | No | DynamoDB rollups table name |
| `TOMTOM_ADMIN_KEY` | No | TomTom POI search API key |
| `OPENAI_API_KEY` | No | OpenAI API key (AI tour guide) |
| `ELEVENLABS_API_KEY` | No | ElevenLabs TTS API key |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice ID |

### Build Commands

```bash
npm run dev            # Dev server
npm run build          # Build data files + Next.js (runs build:data first)
npm run build:data     # Generate duration-matrix.json (6MB) from GTFS schedules
npm run lint           # ESLint (flat config)
npm run test:run       # Vitest single run (662 tests, 44 files)
npm run test:coverage  # Vitest with coverage
```
