Last Updated: 2026-02-23

# server-deep-review — Code Review

## Executive Summary

The WebSocket server is well-structured for its size and scope. The layering of
ingestion loops, namespace handlers, analytics, and library helpers is clean and
consistent. Graceful degradation (Redis-optional, Neo4j-optional, DynamoDB-optional)
is implemented thoroughly, and the shutdown sequence is thoughtful. The use of pino
structured logging, ioredis, and the Socket.IO Redis adapter follows industry norms.

That said, there are several reliability and correctness issues worth addressing
before this is considered production-hardened. The most significant are: (1) a
feed timeout that is equal to the poll interval, creating back-pressure and
overlap risk; (2) a data-loss window in the metrics flush where buffers are
cleared before the async write completes — if the write throws, that 5-minute
window of data is gone silently; (3) unbounded growth in `activeTripMap` that is
only partially mitigated by the stale-trip cleanup; (4) no input length bounding
on Socket.IO subscription events (room-name injection risk); and (5) the
`cors` package imported as a dependency but never used. None of these are
catastrophic in production today, but items 1–3 represent real reliability risks
under load or partial outage.

---

## Strengths

- Graceful degradation is consistent and correct: every external dependency
  (Redis, Neo4j, DynamoDB, Bedrock) returns null and the server continues
  operating without it.
- The `shutdown()` sequence in `index.ts` is complete: loops are stopped, the
  collector is flushed, Socket.IO and HTTP servers are closed, and external
  connections are drained — with a 10-second hard timeout as a backstop.
- Pino structured logging with child loggers per module is excellent.
  Every log call includes a meaningful context object.
- The `flushing` mutex guard in `metrics-collector.ts` (lines 465–468) correctly
  prevents concurrent flushes.
- Socket.IO namespace design is appropriate: room-based fan-out avoids
  server-side filtering per socket, and per-station subscriber counting in
  `arrivals.ts` prevents CPU waste on unsubscribed stations.
- `withSession()` in `neo4j.ts` correctly closes sessions in a `finally` block,
  preventing Neo4j connection pool exhaustion.
- DynamoDB batch writer chunks at 25 (the API limit) and retries unprocessed
  items with exponential backoff.
- The `loadStopsDict()` and `loadProtoSchema()` functions are lazily loaded and
  cached in module-level singletons — correct pattern for long-lived servers.
- Reservoir sampling in `metrics-collector.ts` for median headway is a solid
  approach that avoids unbounded array growth.
- `seed-neo4j.ts` uses `MERGE`-safe `CONSTRAINT IF NOT EXISTS` and awaits index
  population before inserting data.

---

## Critical Issues (must fix)

- [ ] **Feed timeout equals poll interval — overlapping cycles possible**

  File: `server/src/ingestion/feed-loop.ts`, lines 28–29

  ```typescript
  const POLL_INTERVAL_MS = 15_000;
  const FEED_TIMEOUT_MS = 15_000;
  ```

  `axios` timeout is `15_000 ms` and the `setInterval` fires every `15_000 ms`.
  If all 8 feeds are slow, `runCycle()` can take up to 15 s. The next interval
  fires while the previous cycle is still awaiting. Because `runCycle` is
  `async` and the interval does not track whether the previous cycle is still
  running, two cycles can be live simultaneously — both writing to Redis and
  calling `onUpdate` concurrently. This doubles feed-loop traffic and can cause
  out-of-order `previousTripIds` updates, producing ghost "removed trip" events.

  Suggested fix: reduce `FEED_TIMEOUT_MS` to `10_000` (so cycles always finish
  before the next interval) or replace `setInterval` with a self-scheduling
  pattern:

  ```typescript
  async function scheduleNext(onUpdate: FeedUpdateCallback): Promise<void> {
    await runCycle(onUpdate);
    if (running) {
      loopTimer = setTimeout(() => scheduleNext(onUpdate), POLL_INTERVAL_MS);
    }
  }
  ```

- [ ] **Metrics data loss: buffers cleared before async write completes**

  File: `server/src/analytics/metrics-collector.ts`, lines 724–754

  ```typescript
  // Clear buffers before async write
  buffers.clear();   // <-- line 725, data is gone from here

  try {
    await Promise.all([
      writeMetrics(metrics),   // <-- can throw
      ...
    ]);
  } catch (err) {
    log.error(..., 'flush error');  // error logged but data is lost
  } finally {
    flushing = false;
  }
  ```

  If `writeMetrics` (or `writeEvents`/`writeRollups`) throws, the catch block
  logs the error and continues. The data that was in `buffers` has already been
  cleared from memory at line 725 and will never be written to DynamoDB. Five
  minutes of metrics are silently dropped.

  Suggested fix: clear buffers only after a successful write, or keep a
  "pending write" snapshot and restore on failure:

  ```typescript
  const snapshot = new Map(buffers);
  buffers.clear();
  try {
    await Promise.all([writeMetrics(metrics), ...]);
  } catch (err) {
    log.error(..., 'flush error — metrics lost for this cycle');
    // Optionally: merge snapshot back into buffers for next flush attempt
    // (careful about unbounded growth if outage is prolonged)
  }
  ```

- [ ] **`activeTripMap` grows unboundedly during DynamoDB outages**

  File: `server/src/analytics/metrics-collector.ts`, lines 111, 300–330

  ```typescript
  const activeTripMap = new Map<string, ActiveTrip>();
  ```

  The stale-trip cleanup runs inside `flush()` (line 702). If DynamoDB is
  misconfigured or temporarily unavailable, `getDynamoClient()` returns null
  at the top of `flush()` (line 463), so the entire body is skipped — including
  the stale-trip cleanup. Meanwhile `collectMetrics()` bypasses the guard too
  (line 208: `if (!getDynamoClient()) return`) so new trips are never added
  to `activeTripMap`. This is actually correct — no trips accumulate when
  DynamoDB is absent. However, if DynamoDB comes back online mid-session, the
  map is empty and historical trip data is lost. The real risk is: if
  DynamoDB is configured but its write is failing (throwing, not returning
  null), `flush()` runs but exits at the `writeMetrics` throw, so the stale
  cleanup at line 702–722 _runs but deletions happen before the write_.
  Map deletions are irreversible and the TRIP_END events are never written.

  Additionally, each `ActiveTrip` holds a `visitedStops: Set<string>` that
  grows with every stop the train visits. A long-running express train could
  accumulate dozens of entries — benign at current scale but worth noting.

  Suggested fix: run stale-trip cleanup unconditionally, outside the try/catch
  write block, or at minimum after a successful write.

---

## Important Improvements (should fix)

- [ ] **No input length bounding on Socket.IO subscription payloads**

  Files:
  - `server/src/namespaces/trains.ts`, line 72–73
  - `server/src/namespaces/alerts.ts`, line 46–47
  - `server/src/namespaces/arrivals.ts`, line 67–70

  The handlers validate `typeof routeId === "string"` and `routeId.trim()` but
  do not cap length. A malicious client can send a 1 MB string as a `routeId`,
  creating an equally large room name stored in Socket.IO's room registry. With
  many connections this is a potential denial-of-service.

  ```typescript
  // Current:
  socket.on("subscribe:route", (routeId: string) => {
    if (typeof routeId !== "string" || !routeId.trim()) return;

  // Suggested:
  socket.on("subscribe:route", (routeId: unknown) => {
    if (typeof routeId !== "string" || !routeId.trim() || routeId.length > 10) return;
  ```

  Station IDs should be bounded similarly (e.g., max 20 characters).

- [ ] **Alert loop does not send MTA API key**

  File: `server/src/ingestion/alert-loop.ts`, lines 198–202

  ```typescript
  const resp = await axios.get<MtaAlertsResponse>(ALERTS_URL, {
    timeout: FETCH_TIMEOUT_MS,
    // No x-api-key header
  });
  ```

  The feed loop (`feed-loop.ts` lines 455–459) correctly reads
  `process.env.MTA_API_KEY` and attaches it. The alert loop does not. The MTA
  JSON alert endpoint requires the same API key. Without it, requests will
  succeed today (the MTA has been inconsistent about enforcement) but may begin
  returning 401/403 without warning.

  ```typescript
  const apiKey = process.env.MTA_API_KEY;
  const resp = await axios.get<MtaAlertsResponse>(ALERTS_URL, {
    timeout: FETCH_TIMEOUT_MS,
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });
  ```

- [ ] **`cors` package is a dead dependency**

  File: `server/package.json`, line 21 and 29

  ```json
  "cors": "^2.8.5",
  "@types/cors": "^2.8.17",
  ```

  Neither `cors` nor `@types/cors` are imported anywhere in `server/src/`.
  CORS is handled manually in `index.ts` (lines 38–43). Remove these two
  packages to reduce the supply chain surface.

- [ ] **Dockerfile has no HEALTHCHECK instruction**

  File: `server/Dockerfile`

  The Docker image exposes port 3001 and the server has a health endpoint at
  `GET /` returning `{ status: "ok" }`, but the Dockerfile does not declare a
  `HEALTHCHECK`. Without it, Docker/ECS/Kubernetes cannot distinguish a crashed
  container from a healthy one.

  Add before `CMD`:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
  ```

- [ ] **No `unhandledRejection` / `uncaughtException` handlers**

  File: `server/src/index.ts`

  The server registers `SIGINT` and `SIGTERM` handlers but not
  `process.on('unhandledRejection')` or `process.on('uncaughtException')`.
  Node.js will crash the process on unhandled rejections since Node 15. Pino
  should log these before exit.

  ```typescript
  process.on('unhandledRejection', (reason) => {
    log.fatal({ reason }, 'unhandled rejection — crashing');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.fatal({ err: err.message }, 'uncaught exception — crashing');
    process.exit(1);
  });
  ```

- [ ] **Redis main client is never explicitly connected (relying on ioredis auto-connect)**

  File: `server/src/lib/redis.ts`, lines 19–23

  ```typescript
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  ```

  With `lazyConnect: true` and `enableOfflineQueue: false`, ioredis will
  auto-connect on the first command. However, if Redis is down at that moment,
  the first `getCache` or `setCache` call will receive an error and silently
  return null (swallowed in the catch). This is acceptable for the cache path
  but means the pub/sub clients and the cache client have asymmetric startup
  behavior (pub/sub are explicitly `await connect()`-ed). At minimum, add a
  startup connectivity log for the main client:

  ```typescript
  client.on('ready', () => log.info({ client: label }, 'connected'));
  ```

- [ ] **`pino-pretty` in devDependencies but required at runtime in non-production**

  File: `server/package.json`, line 31 and `server/src/lib/logger.ts`, lines 4–14

  `pino-pretty` is in `devDependencies` but the transport is configured
  unconditionally when `NODE_ENV !== 'production'`. If the server is started
  without `NODE_ENV=production` on a machine that ran `npm ci --omit=dev`,
  pino will throw on startup because the transport target cannot be resolved.
  In Docker production builds that run `npm ci` without `--omit=dev` this is
  fine, but a staging deployment with `NODE_ENV=staging` would fail silently
  or crash.

  Move `pino-pretty` to `dependencies`, or add a runtime guard:
  ```typescript
  const transport = process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { ... } }
    : undefined;
  ```

- [ ] **Timeout classification misses `ETIMEDOUT` (network-level timeout)**

  File: `server/src/ingestion/feed-loop.ts`, lines 490–492

  ```typescript
  const isTimeout =
    axios.isAxiosError(err) && err.code === "ECONNABORTED";
  ```

  Axios uses `ECONNABORTED` for request-body timeouts but `ETIMEDOUT` for
  connection-establishment timeouts. A hung TCP connection to the MTA API
  will be classified as `"error"` rather than `"timeout"`. Both codes should
  be checked:

  ```typescript
  const isTimeout =
    axios.isAxiosError(err) &&
    (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT");
  ```

- [ ] **`shortestPath` in Cypher does not apply cost weights — it finds hop-optimal, not time-optimal paths**

  File: `server/src/lib/queries/trip-planner.ts`, lines 57, 75

  ```cypher
  MATCH path = shortestPath((o)-[:CONNECTS_TO*..50]->(d))
  ```

  Cypher's `shortestPath` built-in finds the path with the fewest
  _relationships_ (hops), not the minimum total `duration`. A direct but
  slow route (3 hops, 45 min) will be preferred over a faster route with
  a transfer (5 hops, 20 min). The `WITH ... reduce(cost=0, ...) ORDER BY
  totalCost` post-filter re-orders results, but `shortestPath` may have
  already discarded the time-optimal path entirely because it had more hops.

  This is a known limitation of Cypher's `shortestPath`. To truly minimize
  travel time, use `apoc.algo.dijkstra` if APOC is installed, or enumerate
  with `allShortestPaths` or bounded-depth matching. Alternatively, document
  the known limitation so future maintainers understand why a 4-hop fast route
  may not appear.

- [ ] **`seed-neo4j.ts` uses `CREATE` instead of `MERGE` — re-running without `--clean` duplicates all nodes**

  File: `server/src/scripts/seed-neo4j.ts`, lines 248–257, 270–279, and many others

  ```cypher
  UNWIND $rows AS s
  CREATE (n:Station { id: s.id, ... })
  ```

  Constraints enforce uniqueness on `id`, so re-running without `--clean`
  will throw a constraint violation on every `Station`, `Route`, and
  `StationRoute` node. The script will crash mid-way through, leaving the
  graph in a partial state. Use `MERGE` for idempotency:

  ```cypher
  UNWIND $rows AS s
  MERGE (n:Station {id: s.id})
  SET n.name = s.name, n.lat = s.lat, n.lon = s.lon,
      n.location = point({latitude: s.lat, longitude: s.lon})
  ```

  The `--clean` flag is documented as the workaround but an unintentional
  re-run (e.g., a deploy pipeline running the seed job twice) will corrupt
  the database. Using `MERGE ... SET` makes re-runs safe by default.

---

## Minor Suggestions (nice to have)

- [ ] **`cache.ts` re-defines `CACHE_KEYS` duplicating `lib/cache-keys.ts`**

  File: `server/src/lib/cache.ts`, lines 10–29

  A second `CACHE_KEYS` object is defined in `cache.ts` (feed positions,
  arrivals, alerts, trips, static data). A separate `cache-keys.ts` exists
  for analytics (`TRANSIT_ANALYSIS`). Having two key registries in the same
  lib folder risks key collisions and makes it harder to audit what is stored
  in Redis. Consolidate into one `cache-keys.ts`.

- [ ] **`schedule-lookup.ts` reads entire `stop_times.txt` into a string in memory**

  File: `server/src/analytics/schedule-lookup.ts`, lines 133–135

  ```typescript
  const stopTimesText = await fs.readFile(stopTimesPath, 'utf8');
  const stLines = stopTimesText.split('\n')...
  ```

  `stop_times.txt` for NYC GTFS is approximately 35 MB uncompressed and 1.5M
  lines. Reading the whole file at once is fine at startup, but the nightly
  rebuild (`scheduleRebuild()`) does it again without releasing the previous
  string. During the brief overlap, both strings are in memory (~70 MB peak).
  Consider using a streaming CSV parser (e.g., `node:readline`) to avoid the
  peak.

- [ ] **`toLocalHHMM` in `arrival-loop.ts` uses `toLocaleTimeString` in a server context**

  File: `server/src/ingestion/arrival-loop.ts`, lines 17–28

  `toLocaleTimeString` works correctly on Node.js only if the `full-icu` ICU
  dataset is available. Node 20 ships with full ICU by default, but this is
  worth a comment to flag the dependency for anyone deploying on a slim Node
  build.

- [ ] **`getMTA_API_KEY` read on every feed fetch instead of once at module load**

  File: `server/src/ingestion/feed-loop.ts`, line 455

  ```typescript
  const apiKey = process.env.MTA_API_KEY;
  ```

  `process.env` is accessed on every call to `fetchAndProcessFeed`. Read it
  once at module initialization and log a warning if absent:

  ```typescript
  const MTA_API_KEY = process.env.MTA_API_KEY;
  if (!MTA_API_KEY) log.warn('MTA_API_KEY not set — unauthenticated requests');
  ```

- [ ] **`humanEta` produces "Xm ago" for arrivals slightly in the past**

  File: `server/src/ingestion/arrival-loop.ts`, lines 33–39

  ```typescript
  if (sec < -30) return `${Math.abs(Math.round(sec / 60))}m ago`;
  ```

  For arrivals 31–59 seconds in the past, `Math.round(sec / 60)` rounds to 0,
  producing `"0m ago"` which is confusing. The display should be `"just left"`
  or the item should be excluded from the arrival list (the `t < now - 60_000`
  filter at `arrival-loop.ts` line 83 already filters items more than 1 minute
  past, so this 31–59 second window always produces 0).

  ```typescript
  if (sec < -30) {
    const minAgo = Math.abs(Math.round(sec / 60));
    return minAgo === 0 ? 'just left' : `${minAgo}m ago`;
  }
  ```

- [ ] **`feed-loop.ts` module-level state (`previousTripIds`, `stopsDict`, `FeedMessage`) is not reset on `stopFeedLoop()`**

  File: `server/src/ingestion/feed-loop.ts`, lines 117, 133, 432

  If the server is tested with multiple `startFeedLoop` / `stopFeedLoop` cycles
  (e.g., in integration tests), the previous trip set from the prior run leaks
  into the next run, generating spurious "removed trip" events on the first
  cycle. This is unlikely in production (one lifecycle per process) but is
  worth noting for testability.

- [ ] **`Dockerfile` copies all of `node_modules` (including devDependencies) into production image**

  File: `server/Dockerfile`, lines 23

  ```dockerfile
  COPY --from=deps /app/node_modules ./node_modules
  ```

  The `deps` stage runs `npm ci` (with all dependencies). The production stage
  copies `node_modules` from `deps`, which includes `tsx`, `pino-pretty`, and
  TypeScript. This adds roughly 80–120 MB to the production image. Use a
  separate `npm ci --omit=dev` step for the production image:

  ```dockerfile
  FROM node:20-alpine AS prod-deps
  WORKDIR /app
  COPY package.json package-lock.json* ./
  RUN npm ci --omit=dev

  FROM node:20-alpine AS production
  COPY --from=prod-deps /app/node_modules ./node_modules
  COPY --from=build /app/dist ./dist
  ```

  Note: if `pino-pretty` is moved to `dependencies` (per the earlier
  suggestion), it will be included in `--omit=dev` output, which is correct.

- [ ] **Daily accumulator `dailyAccumDate` check resets the map but not `dailyAlertIds`**

  File: `server/src/analytics/metrics-collector.ts`, lines 477–482

  ```typescript
  if (dailyAccumDate !== today) {
    dailyAccum.clear();
    dailyAlertIds = new Map();   // <-- this IS reset
    dailyAccumDate = today;
  }
  ```

  This is actually correct (both are reset). Noted for completeness; no action
  needed.

---

## Architecture Considerations

### Service Boundaries and State Management

The server holds significant long-lived mutable state at module level:
`previousTripIds`, `stopsDict`, `FeedMessage`, `activeTripMap`, `buffers`,
`dailyAccum`, `subscriberCount`, and the Redis/Neo4j/DynamoDB singletons.
This is appropriate for a single-process server, but means:

1. Horizontal scaling requires all state to be externalized. The Redis adapter
   handles Socket.IO room state, but `previousTripIds` (removed-trip detection),
   `activeTripMap` (trip lifecycle), and `buffers` (metrics accumulation) are
   purely in-process. Running two instances of this server will produce
   duplicated DynamoDB writes and doubled "removed trip" broadcasts per trip.
   The current architecture is explicitly single-instance (the README's Redis
   adapter note says "multi-instance ready" for Socket.IO, but analytics state
   is not multi-instance safe).

2. The stale-trip cleanup threshold of 30 minutes is reasonable, but with 500+
   active trips at peak, `activeTripMap` could hold 500 entries each with a
   `visitedStops: Set<string>`. This is approximately 5–10 MB of live objects
   — not a leak, but worth monitoring.

### Performance

The feed loop fetches all 8 GTFS-RT feeds in parallel (`Promise.all`), which is
good. However, the arrivals namespace recomputes per-station arrivals from raw
entities on every feed cycle, for every subscribed station. At 8 feed groups x
15 s cycles with many subscribed stations, this is O(stations * entities) work
per cycle. The `filterStopIds` optimization mitigates this, but consider caching
computed arrival maps in Redis (which is already the pattern in `cache.ts` for
`cacheArrivals`) and having the namespace serve cached data rather than always
recomputing.

### Security

- The HTTP server does not rate-limit requests to `/api/transit-analysis`. A
  single client can send thousands of requests per second, each performing a
  Redis GET. This is low-cost but should be bounded.
- The `allowedOrigins` CORS list for Socket.IO is correctly applied, but the
  HTTP server's manual CORS implementation (lines 38–43 of `index.ts`) only
  sets the header when the origin matches — it does not block the request when
  the origin does not match. Non-browser clients (e.g., curl, server-to-server)
  will receive a response regardless of origin. This is standard HTTP behavior
  but should be documented.
- Redis connection string (`REDIS_URL`) presumably contains credentials. If it
  uses `rediss://` (TLS), ioredis will negotiate TLS automatically. If it is
  `redis://` over a VPC internal network (common on AWS), there is no
  encryption in transit. This is an infrastructure concern, not a code concern,
  but worth confirming in the deployment docs.

### Data Flow

The `broadcastArrivals` function in `index.ts` (line 180) is called once per
feed group per cycle (8 times per 15 s). Each call to `broadcastArrivals`
calls `computeArrivals` over only that feed group's entities. Stations that are
served by multiple feed groups (e.g., a transfer station where the A and the 4
both stop) will receive partial arrival boards — one with A/C/E trains and one
with 4/5/6 trains — broadcast in rapid succession. The client must merge them.
The existing `broadcastArrivalsBatch` function handles multi-feed merging
correctly, but it is not currently used. The current pattern produces correct
results but generates more Socket.IO events than necessary. Consider accumulating
all 8 feed groups' entities within a cycle and calling `broadcastArrivalsBatch`
once per cycle.

---

## Next Steps

1. Reduce `FEED_TIMEOUT_MS` to `10_000` in `feed-loop.ts` (or switch to a
   self-scheduling pattern) to prevent overlapping cycle executions.
2. Fix the data-loss window in `metrics-collector.ts` flush: do not clear
   `buffers` until after `Promise.all` resolves successfully.
3. Add `process.on('unhandledRejection')` and `process.on('uncaughtException')`
   handlers in `index.ts`.
4. Add MTA API key header to the alert loop in `alert-loop.ts`.
5. Add length bounds to all Socket.IO event payloads in the three namespace
   handlers.
6. Add `HEALTHCHECK` to `server/Dockerfile`.
7. Remove the unused `cors` and `@types/cors` packages from `package.json`.
8. Change `seed-neo4j.ts` `CREATE` statements to `MERGE ... SET` for safe
   re-runs.
9. Move `pino-pretty` from `devDependencies` to `dependencies` (or guard the
   transport with `NODE_ENV === 'development'` strictly).
10. Separate production `node_modules` in the Dockerfile (`npm ci --omit=dev`)
    to reduce image size.
