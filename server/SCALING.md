# Scaling Constraints

The WebSocket server (`server/`) currently **must run as a single instance**. This document explains why, catalogs all in-memory state, and provides a migration path for horizontal scale-out.

The `ws-server` service in `infra/docker-compose.prod.yml` is pinned to `deploy.replicas: 1`. Do not increase this without completing the migration checklist at the bottom of this file.

## Why Single-Instance Is Required

The server uses in-process JavaScript `Map` and `Set` objects as the authoritative source of truth for several stateful operations:

- **Trip removal detection** compares the current set of trip IDs against the previous cycle's set. Two instances would each maintain independent copies, producing duplicate `trains:remove` WebSocket events and missing removals for trips that happen to land on the other instance.
- **Alert diffing** tracks which alert IDs existed in the previous cycle to emit `alerts:new` and `alerts:cleared` events. Two instances would produce duplicate diff events.
- **Subscriber tracking** for per-station arrival boards uses a reference-counted map. Each instance only knows about its own connected sockets, so arrival computation would be split (some stations would get no updates at all).
- **Metrics accumulation** buffers per-route statistics (delays, headways, bunching) between 5-minute DynamoDB flushes. Two instances each see only half the data, producing incorrect averages, counts, and rollups.
- **Trip lifecycle tracking** observes when trips first appear and disappear to record duration and stops served. Two instances would produce duplicate `TRIP_START` events and inaccurate trip metadata.

The Socket.IO Redis adapter handles cross-instance message broadcasting correctly, but the application-level state listed above is not shared through Redis.

## In-Memory State Inventory

### Stateful (breaks under multi-instance)

| File | Variable | Type | Purpose | Multi-Instance Impact |
|------|----------|------|---------|----------------------|
| `src/ingestion/feed-loop.ts` | `previousTripIds` | `Map<string, Set<string>>` | Previous cycle's trip IDs per feed group, used to detect removed trains | Duplicate `trains:remove` events; missed removals |
| `src/ingestion/feed-loop.ts` | `loopTimer`, `running` | Timer / boolean | Feed polling loop lifecycle | Duplicate MTA API calls (2x load on MTA, wasted bandwidth) |
| `src/ingestion/alert-loop.ts` | `previousAlertIds` | `Set<string>` | Previous cycle's alert IDs for new/cleared detection | Duplicate new/cleared alert log entries |
| `src/namespaces/alerts.ts` | `previousAlerts` | `Map<string, ServiceAlert>` | Previous alert state for WebSocket diffing | Duplicate `alerts:new` and `alerts:cleared` events to clients |
| `src/namespaces/arrivals.ts` | `subscriberCount` | `Map<string, number>` | Reference-counted station subscriber tracking | Split subscriber state; stations with subscribers on another instance get zero arrival updates |
| `src/analytics/metrics-collector.ts` | `buffers` | `Map<string, RouteBuffer>` | Per-route metrics accumulated between 5-min flushes | Each instance sees partial data; averages, counts, and percentages are wrong |
| `src/analytics/metrics-collector.ts` | `activeTripMap` | `Map<string, ActiveTrip>` | Trip lifecycle tracking (start time, stops visited, duration) | Duplicate `TRIP_START` events; inaccurate duration and stops-served counts |
| `src/analytics/metrics-collector.ts` | `dailyAccum` | `Map<string, DailyAccum>` | Running daily rollup counters (delays, headways, bunching totals) | Each instance writes partial daily rollups to DynamoDB |
| `src/analytics/metrics-collector.ts` | `dailyAlertIds` | `Map<string, Set<string>>` | Unique alert ID tracking per route for daily rollup | Under-counted or over-counted alert totals |
| `src/analytics/metrics-collector.ts` | `activeAlertCount`, `latestAlertDetails` | number / array | Current alert snapshot for SYSTEM_HEALTH record | Each instance reports partial alert state |
| `src/analytics/metrics-collector.ts` | `flushing` | boolean | Reentrance guard for flush | No cross-instance coordination; both instances could flush simultaneously |
| `src/analytics/position-archiver.ts` | `buffer` | `Map<string, StampedPosition[]>` | Positions buffered before S3 flush | Duplicated S3 writes (not incorrect, but doubles storage cost; downstream must deduplicate) |

### Safe (read-only after initialization or stateless)

| File | Variable | Type | Why Safe |
|------|----------|------|----------|
| `src/ingestion/feed-loop.ts` | `FeedMessage` | `protobuf.Type` | Loaded once, never mutated |
| `src/ingestion/feed-loop.ts` | `stopsDict` | `Record<string, Stop>` | Loaded once from `stops.txt`, never mutated |
| `src/analytics/schedule-lookup.ts` | `scheduleMap` | `Map<string, number>` | Loaded from GTFS static files, rebuilt at midnight. Read-only between rebuilds |
| `src/analytics/schedule-lookup.ts` | `currentServiceId` | `string` | Read-only between midnight rebuilds |
| `src/analytics/metrics-collector.ts` | `stopNameMap` | `Map<string, string>` | Loaded once from `stops.txt`, never mutated |
| `src/analytics/metrics-collector.ts` | `firstDelayLogDone` | boolean | Diagnostic flag; harmless if duplicated |
| `src/analytics/transit-analyzer.ts` | `bedrockClient` | `BedrockRuntimeClient` | Lazy singleton; stateless HTTP client |
| `src/lib/auth.ts` | (none) | | Purely functional; reads env var on each call |
| `src/lib/cache.ts` | (none) | | Delegates to Redis; no local state |

## Scale-Out Migration Plan

To run multiple instances, each piece of stateful in-memory data must be externalized to Redis (or another shared store). Below is the approach for each.

### 1. `previousTripIds` (feed-loop.ts)

**Current**: `Map<string, Set<string>>` keyed by feed group ID.

**Target**: Redis Set per feed group, e.g., `feed:{groupId}:prevTrips`.

**Approach**: After each feed cycle, compute the new trip ID set. Use `SDIFF` (old minus new) to get removed trips. Then replace the stored set with `DEL` + `SADD` (or use a rename-based swap). TTL of 60s as a safety net.

### 2. `previousAlertIds` (alert-loop.ts) and `previousAlerts` (namespaces/alerts.ts)

**Current**: `Set<string>` and `Map<string, ServiceAlert>`.

**Target**: Redis Hash `alerts:previous` mapping alert ID to serialized alert JSON.

**Approach**: After each alert cycle, compare current IDs against `HKEYS alerts:previous`. New IDs = those not in the hash. Cleared IDs = those in the hash but not in current. Then overwrite the hash. Only one instance should run the diff to avoid duplicate events -- use a Redis lock (`SET alerts:diff:lock EX 5 NX`) or designate the alert loop to a single leader.

### 3. `subscriberCount` (namespaces/arrivals.ts)

**Current**: `Map<string, number>` tracking per-station subscriber count.

**Target**: Redis Hash `arrivals:subscribers` with `HINCRBY`/`HDECRBY`.

**Approach**: On subscribe, `HINCRBY arrivals:subscribers {stationId} 1`. On unsubscribe/disconnect, `HINCRBY arrivals:subscribers {stationId} -1`. To get subscribed station IDs, `HGETALL` and filter for count > 0. Challenge: if an instance crashes without running disconnect handlers, counts leak. Mitigation: periodic reconciliation job that checks actual Socket.IO room sizes via Redis adapter and corrects the subscriber hash. Alternatively, use per-instance keys with TTLs.

### 4. `buffers` and `dailyAccum` (metrics-collector.ts)

**Current**: `Map<string, RouteBuffer>` and `Map<string, DailyAccum>` with running counters.

**Target**: Redis Hashes with atomic increment operations.

**Approach A (distributed counters)**: Use `HINCRBYFLOAT` for each running counter (sum of delays, count of delays, bunching count, etc.). On flush, `HGETALL` to read and `DEL` to reset atomically (via Lua script). Works but complex -- many fields per route per direction.

**Approach B (single-writer with leader election)**: Elect one instance as the metrics writer. Other instances publish raw observations via Redis Pub/Sub or a Redis List. The leader consumes and accumulates. Simpler to reason about correctness but introduces a single point of failure for analytics (not for core train data).

**Recommendation**: Approach B for initial scale-out. Analytics can tolerate brief gaps; core train broadcasting cannot.

### 5. `activeTripMap` (metrics-collector.ts)

**Current**: `Map<string, ActiveTrip>` tracking trip lifecycle.

**Target**: Redis Hash per trip, e.g., `trip:active:{tripId}` with fields for routeId, direction, startedAt, lastSeenAt, stopsServed, visitedStops (serialized set). TTL of 45 minutes for automatic stale cleanup.

**Approach**: On each feed cycle, `HSETNX` for new trips (returns 1 only on creation, avoiding duplicate TRIP_START events). `HSET` to update lastSeenAt and visitedStops. On removal, read the hash, write the TRIP_END event, then `DEL`.

### 6. Feed/alert polling loops

**Current**: Each instance runs its own polling loop, fetching from MTA APIs.

**Target**: Only one instance should poll. Others consume cached data from Redis.

**Approach**: Leader election via Redis lock (`SET feed:leader {instanceId} EX 30 NX`). Leader renews the lock every 15s. If the lock expires (leader crashed), another instance acquires it. Non-leaders skip the fetch and read from Redis cache instead.

### 7. Position archiver buffer

**Current**: `Map<string, StampedPosition[]>` buffered before S3 flush.

**Impact**: Low -- multiple instances just write more S3 files. Downstream analytics (Athena) can handle duplicates with `SELECT DISTINCT`.

**Target**: No change needed for correctness. Optionally, consolidate under leader election to halve S3 costs.

## Migration Checklist

- [ ] Externalize `previousTripIds` to Redis Sets with `SDIFF` for removal detection
- [ ] Externalize `previousAlertIds` / `previousAlerts` to Redis Hash with distributed lock for diffing
- [ ] Externalize `subscriberCount` to Redis Hash with `HINCRBY` and crash-recovery reconciliation
- [ ] Externalize metrics `buffers` to Redis (leader-election single-writer or distributed counters)
- [ ] Externalize `activeTripMap` to Redis Hashes with `HSETNX` for deduplication
- [ ] Externalize `dailyAccum` and `dailyAlertIds` to Redis Hashes
- [ ] Implement leader election for feed/alert polling loops
- [ ] Add distributed lock for single-writer operations (DynamoDB flush, S3 archival, Bedrock analysis)
- [ ] Load test with 2 instances behind nginx to verify event deduplication and subscriber coverage
- [ ] Update Docker Compose to remove `replicas: 1` constraint
- [ ] Update monitoring/alerting dashboards for multi-instance metrics (per-instance and aggregate)
- [ ] Document rollback procedure (scale back to 1 and restart)
