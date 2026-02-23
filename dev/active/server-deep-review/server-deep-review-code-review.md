Last Updated: 2026-02-23

# server-deep-review — Code Review (Revision 2)

> This document supersedes the Revision 1 review of the same date. It reflects
> a fresh full read of all 25 server source files, cross-references which
> findings from Revision 1 have been addressed, and adds new findings not
> present in the original review.

---

## Executive Summary

The WebSocket server is a well-engineered, 2,500-line Node.js process. The
layering is clean: ingestion loops, Socket.IO namespace handlers, analytics
pipeline, and library helpers are all in clearly bounded modules. Graceful
degradation across all four optional external services (Redis, Neo4j, DynamoDB,
S3/Bedrock) is consistent and correct. The shutdown sequence, pino structured
logging, and DynamoDB batch-write retry logic are all production-quality.

Since Revision 1 (earlier today), two of the three previously-flagged Critical
issues have been fixed:

1. **Feed timeout reduced to 12 s** (`FEED_TIMEOUT_MS = 12_000`) — the
   overlap-cycle risk is now materially lower. The feed loop already used a
   self-scheduling setTimeout pattern, so the prior review's claim about
   setInterval was incorrect for the feed loop. However, the alert loop still
   uses setInterval, creating a minor asymmetry.
2. **Metrics `buffers.clear()` moved after `Promise.all`** — data-loss window
   on DynamoDB write failure is now closed.

Seven issues from Revision 1 remain open (Critical: 1, Important: 6). Five new
findings are added in this revision (Important: 2, Minor: 3).

---

## Strengths

- Graceful degradation is consistent and correct throughout: every external
  dependency check returns null and continues without it.
- Shutdown sequence in `index.ts` is complete: ingestion loops stop, analytics
  flush, Socket.IO and HTTP close, and all external connections are drained
  with a 10-second hard timeout.
- Pino structured logging with per-module child loggers is excellent.
- `flushing` mutex in `metrics-collector.ts` (line 534) correctly prevents
  concurrent flush execution.
- Socket.IO room-based fan-out is appropriate; per-station subscriber counting
  prevents wasted CPU on unsubscribed stations.
- `withSession()` in `neo4j.ts` closes sessions in a `finally` block.
- DynamoDB batch writer chunks at 25 items and retries with exponential backoff.
- `loadStopsDict()` and `loadProtoSchema()` are lazy-loaded and cached as
  module-level singletons.
- Reservoir sampling in `metrics-collector.ts` for median headway avoids
  unbounded array growth.
- `seed-neo4j.ts` awaits index population (`db.awaitIndexes`) before inserting
  data, which is the correct sequence.

---

## Critical Issues (must fix)

- [ ] **`activeTripMap` stale-trip cleanup runs before DynamoDB write — trip end events are lost on write failure**

  File: `server/src/analytics/metrics-collector.ts`, lines 786–809 and 811–816

  The stale-trip loop (lines 786–809) deletes entries from `activeTripMap` and
  appends `TRIP_END` events to `delayEvents`. This loop runs before the
  `try { await Promise.all([...]) }` block at line 811. If `writeEvents` throws,
  the catch block at line 865 logs the error but the `activeTripMap` deletions
  have already happened and the TRIP_END events are lost.

  The `buffers.clear()` fix correctly moved buffer clearing inside the `try`
  success path (line 818), but the stale-trip cleanup at line 786 was not
  similarly guarded.

  ```typescript
  // Current (lines 786–809): runs unconditionally before the write
  for (const [tripId, trip] of activeTripMap) {
    if (staleNow - trip.lastSeenAt > STALE_TRIP_THRESHOLD) {
      // ...builds event and then...
      activeTripMap.delete(tripId);  // <-- irreversible
    }
  }

  // Then at line 811:
  try {
    await Promise.all([writeMetrics(metrics), writeEvents(delayEvents), ...]);
    buffers.clear(); // correctly inside try-success path
  } catch (err) {
    log.error(..., 'flush error'); // delayEvents from stale cleanup are lost
  }
  ```

  Suggested fix: move the stale-trip iteration into a pre-processing step that
  builds the events, but defer `activeTripMap.delete(tripId)` to inside the
  `try` success path alongside `buffers.clear()`.

---

## Important Improvements (should fix)

- [ ] **No Socket.IO connection authentication — any origin can subscribe**

  Files: `server/src/namespaces/trains.ts`, `alerts.ts`, `arrivals.ts`

  The Socket.IO namespaces accept connections without any auth check. The HTTP
  CORS origin list (`allowedOrigins`) is applied to the Socket.IO `cors` option
  at the server level, which controls which browser origins can upgrade to
  WebSocket. However, non-browser clients (Node.js scripts, curl-WS, Postman
  WebSocket) bypass the CORS check entirely and can subscribe to any room.

  At minimum, add a Socket.IO middleware that validates a shared secret or
  JWT for non-browser environments. Example:

  ```typescript
  trainsNsp.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (process.env.WS_AUTH_TOKEN && token !== process.env.WS_AUTH_TOKEN) {
      return next(new Error('unauthorized'));
    }
    next();
  });
  ```

  Without this, a malicious actor with the server's public address can stream
  all real-time train positions.

- [ ] **No input length bounding on Socket.IO subscription payloads**

  Files: `server/src/namespaces/trains.ts` line 73, `alerts.ts` line 46,
  `arrivals.ts` line 68

  All three handlers validate `typeof x === "string"` but do not cap string
  length. A client sending a 1 MB `routeId` creates a 1 MB room name in the
  Socket.IO room registry. Repeated across many connections, this is a viable
  memory exhaustion vector.

  ```typescript
  // Current in trains.ts (line 73):
  socket.on("subscribe:route", (routeId: string) => {
    if (typeof routeId !== "string" || !routeId.trim()) return;

  // Suggested:
  socket.on("subscribe:route", (routeId: unknown) => {
    if (typeof routeId !== "string" || !routeId.trim() || routeId.length > 10) return;
  ```

  Route IDs are at most 3 characters. Station IDs are at most ~8 characters.
  Apply appropriate caps (e.g., `routeId.length > 10`, `stationId.length > 20`).

- [ ] **Alert loop does not send MTA API key**

  File: `server/src/ingestion/alert-loop.ts`, lines 198–202

  The feed loop at `feed-loop.ts` line 455 correctly reads `MTA_API_KEY` and
  attaches it as `x-api-key`. The alert loop does not:

  ```typescript
  const resp = await axios.get<MtaAlertsResponse>(ALERTS_URL, {
    timeout: FETCH_TIMEOUT_MS,
    // No x-api-key header
  });
  ```

  Fix:
  ```typescript
  const apiKey = process.env.MTA_API_KEY;
  const resp = await axios.get<MtaAlertsResponse>(ALERTS_URL, {
    timeout: FETCH_TIMEOUT_MS,
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });
  ```

- [ ] **No `unhandledRejection` / `uncaughtException` handlers**

  File: `server/src/index.ts`

  `SIGINT` and `SIGTERM` are handled but unhandled promise rejections and
  synchronous throws from background async work will crash Node.js silently
  (no structured log, just a stack dump). Add:

  ```typescript
  process.on('unhandledRejection', (reason) => {
    log.fatal({ reason }, 'unhandled rejection — crashing');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.fatal({ err: err instanceof Error ? err.message : err }, 'uncaught exception — crashing');
    process.exit(1);
  });
  ```

- [ ] **Timeout classification misses `ETIMEDOUT` (connection-level timeout)**

  File: `server/src/ingestion/feed-loop.ts`, lines 490–492

  ```typescript
  const isTimeout = axios.isAxiosError(err) && err.code === "ECONNABORTED";
  ```

  `ECONNABORTED` covers only request body timeouts. A hung TCP handshake to
  the MTA API produces `ETIMEDOUT`, which this classifies as a generic `"error"`
  status rather than `"timeout"`. Both codes should be checked:

  ```typescript
  const isTimeout =
    axios.isAxiosError(err) &&
    (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT");
  ```

- [ ] **`shortestPath` in Cypher minimizes hops, not travel time**

  File: `server/src/lib/queries/trip-planner.ts`, lines 57, 75

  ```cypher
  MATCH path = shortestPath((o)-[:CONNECTS_TO*..50]->(d))
  ```

  Cypher's `shortestPath` finds the path with fewest relationships (hops), not
  minimum `duration` cost. A direct 3-hop 45-minute route is preferred over a
  5-hop 20-minute route. The `reduce(cost=0, ...) ORDER BY totalCost` in the
  `WITH` clause re-ranks results, but `shortestPath` may have already discarded
  the time-optimal path before that clause is reached.

  To find cost-optimal paths: use `apoc.algo.dijkstra` if APOC is available,
  or use `allShortestPaths` (finds all hop-minimal paths then picks by cost)
  as an interim improvement. At minimum, add a code comment documenting this
  limitation so future developers understand why certain faster routes may not
  appear in results.

- [ ] **`seed-neo4j.ts` uses `CREATE` — re-running without `--clean` throws constraint violation**

  File: `server/src/scripts/seed-neo4j.ts`, multiple Cypher statements
  (e.g., lines 248–257, 270–279)

  All node-creation statements use `CREATE` rather than `MERGE`. Running the
  script a second time without `--clean` hits the unique constraints and throws
  on the first batch, leaving the graph in a partial state. Use `MERGE ... SET`
  for safe idempotency:

  ```cypher
  UNWIND $rows AS s
  MERGE (n:Station {id: s.id})
  SET n.name = s.name, n.lat = s.lat, n.lon = s.lon,
      n.location = point({latitude: s.lat, longitude: s.lon})
  ```

  Edge creation (CONNECTS_TO) should similarly use `MERGE` or check for
  existence before creating.

---

## New Findings (not in Revision 1)

### Important

- [ ] **`transit-analyzer.ts` `toMin` function has an off-by-6 error in the conversion formula**

  File: `server/src/analytics/transit-analyzer.ts`, lines 49–51

  ```typescript
  function toMin(seconds: number | null | undefined): number | null {
    if (seconds == null) return null;
    return Math.round(seconds / 6) / 10; // 1 decimal place
  }
  ```

  The comment says "1 decimal place" but the formula divides by 6 then by 10,
  which is equivalent to dividing by 60 — correct for seconds-to-minutes. The
  rounding produces 1 decimal place. However, the intent and the math are easy
  to confuse because `/ 6 / 10` is non-obvious. A more correct and readable
  form is:

  ```typescript
  return Math.round((seconds / 60) * 10) / 10;
  ```

  More importantly, the same function is used to convert `headwayAvgSeconds`
  to minutes for the Bedrock prompt. `headwayAvgSeconds` is stored in the
  `MetricRecord` as seconds (line 597 of metrics-collector.ts: `headwayAvgSeconds:
  avgHeadway != null ? Math.round(avgHeadway) : null`). The conversion is
  correct. The risk is that a future developer changes a unit somewhere and the
  non-obvious `/ 6 / 10` form masks the bug. Rename and document clearly.

- [ ] **`alert-loop.ts` uses `setInterval`, while `feed-loop.ts` uses self-scheduling `setTimeout` — inconsistency creates overlap risk for alerts**

  Files: `server/src/ingestion/alert-loop.ts` line 244, vs `feed-loop.ts`
  line 575

  The feed loop correctly uses a self-scheduling `setTimeout` to prevent
  overlapping cycles when a fetch takes close to the timeout duration. The
  alert loop still uses `setInterval` at line 244. If an alert fetch is slow
  (e.g., MTA API is sluggish and takes 15+ seconds), the interval fires a
  second fetch while the first is still in-flight. With a 15-second fetch
  timeout and a 60-second interval, this is low-probability but not
  impossible.

  The fix is to apply the same self-scheduling `setTimeout` pattern:

  ```typescript
  async function scheduledFetch(onUpdate: AlertUpdateCallback): Promise<void> {
    await fetchAndProcess(onUpdate).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'fetch error')
    );
    if (running) {
      loopTimer = setTimeout(() => scheduledFetch(onUpdate), POLL_INTERVAL_MS);
    }
  }
  ```

  The `ReturnType<typeof setInterval>` type on `loopTimer` would change to
  `ReturnType<typeof setTimeout>` accordingly.

---

## Minor Suggestions (nice to have)

- [ ] **`cache.ts` and `cache-keys.ts` define two separate `CACHE_KEYS` objects — key namespace fragmentation**

  Files: `server/src/lib/cache.ts` lines 10–29, `server/src/lib/cache-keys.ts`

  `cache.ts` defines feed, arrival, alert, and trip keys. `cache-keys.ts`
  defines analytics keys (`TRANSIT_ANALYSIS`, `ANOMALY_FEED`). Two different
  modules import from two different registries, making it impossible to audit
  the full Redis key namespace in one place. Consolidate all keys into
  `cache-keys.ts` and have `cache.ts` import from it.

- [ ] **`pino-pretty` is in `devDependencies` but needed when `NODE_ENV !== 'production'`**

  File: `server/package.json` line 34, `server/src/lib/logger.ts` lines 4–14

  `pino-pretty` is a `devDependency`. The logger configures it whenever
  `NODE_ENV !== 'production'`. On a staging environment that runs
  `npm ci --omit=dev`, pino will throw at startup because the transport
  target cannot be resolved. Either move `pino-pretty` to `dependencies`, or
  restrict the transport to `NODE_ENV === 'development'` explicitly:

  ```typescript
  const transport = process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { ... } }
    : undefined;
  ```

- [ ] **Dockerfile production stage copies `node_modules` from the `deps` stage (includes devDependencies)**

  File: `server/Dockerfile` lines 5 and 22

  The `deps` stage runs `npm ci` with all packages. The `production` stage
  copies `node_modules` from `deps`, including `tsx`, `typescript`, `vitest`,
  and `pino-pretty`. This adds roughly 80–120 MB to the image unnecessarily.
  Add a dedicated production-deps stage:

  ```dockerfile
  FROM node:20-alpine AS prod-deps
  WORKDIR /app
  COPY package.json package-lock.json* ./
  RUN npm ci --omit=dev

  # Production stage
  COPY --from=prod-deps /app/node_modules ./node_modules
  ```

- [ ] **`schedule-lookup.ts` reads all of `stop_times.txt` into a string on nightly rebuild — double-peak memory**

  File: `server/src/analytics/schedule-lookup.ts`, lines 133–135

  `stop_times.txt` for NYC GTFS is ~35 MB. The nightly rebuild (`scheduleRebuild`)
  reads the file while the previous `scheduleMap` is still in memory (assigned
  at line 202 only after the new map is built). During the brief overlap,
  approximately 70 MB of string data is live simultaneously. Consider using
  `node:readline` for a streaming parse to avoid the peak.

- [ ] **`humanEta` in `arrival-loop.ts` produces `"0m ago"` for arrivals 31–59 seconds in the past**

  File: `server/src/ingestion/arrival-loop.ts`, lines 33–39

  ```typescript
  if (sec < -30) return `${Math.abs(Math.round(sec / 60))}m ago`;
  ```

  For `sec` in `[-59, -31]`, `Math.round(sec / 60)` rounds to 0, producing
  `"0m ago"`. The `t < now - 60_000` filter (line 83) removes items older
  than 60 s, so this code path fires only for the 31–59 s window. Fix:

  ```typescript
  if (sec < -30) {
    const minAgo = Math.abs(Math.round(sec / 60));
    return minAgo === 0 ? 'just left' : `${minAgo}m ago`;
  }
  ```

---

## Architecture Considerations

### Horizontal Scaling Readiness

The Redis adapter makes Socket.IO room broadcasting multi-instance safe.
However, the following module-level state is not externalized and will produce
incorrect behavior if two server instances run simultaneously:

- `previousTripIds` in `feed-loop.ts` — both instances independently track
  trip removal and will broadcast duplicated `trains:remove` events.
- `activeTripMap` and `buffers` in `metrics-collector.ts` — both instances
  write to the same DynamoDB tables, doubling every metric record.
- `subscriberCount` in `arrivals.ts` — each instance has its own independent
  count; a disconnect on instance A does not decrement the counter on instance B.

The architecture is explicitly single-instance for analytics. This is an
acceptable design decision but should be documented clearly in the README and
in the Docker Compose config to prevent accidental scale-out.

### Performance: Arrivals Broadcast Pattern

`broadcastArrivals` is called once per feed group per cycle (8 times per 15 s).
Each call recomputes arrival boards for all subscribed stations from that feed
group's entities. For a station served by multiple feed groups (e.g., a
Times Square–42 St complex station), the client receives 2–4 partial arrival
boards in rapid succession per cycle rather than one merged board.

`broadcastArrivalsBatch` (arrivals.ts line 148) correctly merges multi-feed
data, but it is not currently wired into the feed loop. Consider accumulating
all 8 feed groups' entities within one cycle (e.g., in a `Map<string,
FeedEntity[]>`) and calling `broadcastArrivalsBatch` once per cycle. This
reduces Socket.IO events per cycle from up to 8 per station to 1, and produces
a correct merged view rather than requiring client-side merging.

### Security Summary

| Surface | Current State | Risk |
|---------|--------------|------|
| Socket.IO auth | No token validation | Any client can connect and subscribe |
| Socket.IO input size | No length cap | Memory exhaustion via large room names |
| HTTP CORS | Manual origin check but does not block non-browser | Acceptable for public data |
| HTTP rate limiting | None | Low-cost Redis GET but worth bounding |
| Redis credentials | In REDIS_URL env var | Acceptable; confirm TLS (`rediss://`) in prod |
| MTA API key | Feed loop: yes; Alert loop: missing | Alert endpoint may begin enforcing |

### Test Coverage

Only `position-archiver.ts` has a test file (14 tests, good coverage of
buffering, flush, S3 key format, and error handling). The following modules
have zero test coverage:

- `feed-loop.ts` — the most critical path; protobuf decode, position
  interpolation, and removed-trip detection all have meaningful logic.
- `metrics-collector.ts` — complex stateful accumulation with flush logic.
- `schedule-lookup.ts` — GTFS time parsing and trip-key normalization.
- `transit-analyzer.ts` — Bedrock prompt construction and parsing.
- All three namespace handlers.

For a long-running production server, the absence of tests for `feed-loop.ts`
and `metrics-collector.ts` is the most significant gap. A unit test for
`calculateTrainPositions` and for the `flush()` write-then-clear ordering
would prevent regressions on the fixes described above.

---

## Status of Revision 1 Findings

| Finding | Status |
|---------|--------|
| Feed timeout equals poll interval (Critical) | PARTIALLY FIXED — timeout reduced to 12,000 ms. Feed loop uses self-scheduling setTimeout (correct). Alert loop still uses setInterval (new finding). |
| Metrics data loss: buffers cleared before write (Critical) | FIXED — `buffers.clear()` now inside try-success path (line 818). |
| `activeTripMap` stale cleanup runs before write (Critical) | STILL OPEN — stale trip deletion is pre-write, TRIP_END events lost on failure. |
| No input length bounding on Socket.IO payloads (Important) | STILL OPEN |
| Alert loop missing MTA API key (Important) | STILL OPEN |
| `cors` package unused dead dependency (Important) | STILL OPEN — confirmed in package.json line 24. |
| Dockerfile has no HEALTHCHECK (Important) | STILL OPEN |
| No `unhandledRejection` / `uncaughtException` handlers (Important) | STILL OPEN |
| Redis main client not explicitly connected (Important) | STILL OPEN — `lazyConnect: true` with no `ready` log. |
| `pino-pretty` in devDependencies (Important) | STILL OPEN |
| Timeout classification misses `ETIMEDOUT` (Important) | STILL OPEN |
| `shortestPath` minimizes hops not cost (Important) | STILL OPEN |
| `seed-neo4j.ts` uses CREATE not MERGE (Important) | STILL OPEN |
| `cache.ts` / `cache-keys.ts` split key registry (Minor) | STILL OPEN |
| `stop_times.txt` full-string read on rebuild (Minor) | STILL OPEN |
| `toLocalHHMM` ICU dependency undocumented (Minor) | STILL OPEN — acceptable as-is on Node 20. |
| `MTA_API_KEY` read on every fetch (Minor) | STILL OPEN |
| `humanEta` "0m ago" for 31–59 s (Minor) | STILL OPEN |
| `previousTripIds` not reset on stop (Minor) | STILL OPEN |
| Dockerfile copies devDependencies to production (Minor) | STILL OPEN |
| `dailyAccumDate` reset also resets `dailyAlertIds` (Minor) | CLOSED — was a false positive; code is correct. |

---

## Next Steps (Prioritized)

1. **Stale-trip cleanup ordering** — move `activeTripMap.delete(tripId)` calls
   to inside the `try` success path in `metrics-collector.ts`. This is the only
   remaining Critical issue.
2. **Alert loop: add MTA API key header** in `alert-loop.ts` — one line fix.
3. **Alert loop: switch from `setInterval` to self-scheduling `setTimeout`** —
   matches the feed-loop pattern, prevents overlap.
4. **Add `process.on('unhandledRejection')` and `process.on('uncaughtException')`**
   in `index.ts` — prevents silent crashes.
5. **Add Socket.IO input length bounds** in all three namespace handlers.
6. **Add a Socket.IO connection middleware** with optional token validation to
   prevent unauthorized real-time data subscriptions.
7. **Add `HEALTHCHECK` to `server/Dockerfile`**.
8. **Remove unused `cors` / `@types/cors`** from `package.json`.
9. **Change `seed-neo4j.ts` `CREATE` to `MERGE ... SET`** for idempotent
   re-runs.
10. **Add tests for `feed-loop.ts`** — specifically `calculateTrainPositions`
    and removed-trip detection; and for the `flush()` function in
    `metrics-collector.ts` to guard the data-retention ordering.
