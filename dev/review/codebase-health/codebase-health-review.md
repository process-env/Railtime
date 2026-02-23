Last Updated: 2026-02-23

# Railtime Codebase Health Review

---

## Executive Summary

This review synthesizes six parallel domain-specific architectural reviews covering the complete Railtime codebase: API routes and data pipeline (27 route handlers), map rendering stack (SubwayMap + 5 hooks + 6 utility modules), trip planner algorithm (Dijkstra + Neo4j + graph builder), frontend UI and state management (5 stores, 20+ hooks, 14 analytics components), WebSocket server (25 source files, 2,500 lines), and test infrastructure (44 test files, 662 tests).

**Overall Quality Rating: Good -- with critical gaps in security hardening, test coverage, and production resilience.**

The architecture is sound and well-layered. The dual-mode data pipeline (Socket.IO push with React Query polling fallback), the imperative MapLibre marker management, the Dijkstra-over-transit-graph algorithm, and the graceful degradation across all four optional services (Redis, Neo4j, DynamoDB, S3/Bedrock) are all well-conceived and correctly implemented. Code quality across most modules ranges from good to excellent.

**Readiness Assessment: Needs Work.** The codebase is functional and serving users, but several categories of issue must be addressed before it can be considered production-hardened:

1. **Security surface is underprotected.** 23 of 27 API routes have no rate limiting. Socket.IO accepts unauthenticated connections with no input length bounds. Internal error messages leak to clients.
2. **Race conditions in the map animation pipeline.** Two async loops in `useTrainMarkers` run without cancellation guards, producing phantom markers and stale ref writes under concurrent effect execution.
3. **Test coverage has critical gaps.** The entire v2 Socket.IO path (production data path on EC2), all 16 analytics components, and the server ingestion pipeline have 0% test coverage. Several test files inflate the count with console.log-only assertions.
4. **Algorithmic correctness issues.** Neo4j `shortestPath` minimizes hops not travel time. `preferFewerTransfers` is a dead option. The alternative-paths algorithm uses random sampling, not Yen's algorithm.
5. **Dual-client data architecture friction.** Apollo Client (analytics) and React Query (everything else) coexist with separate caches, redundant requests, and no coordination.

**Top 5 Systemic Themes:**

| # | Theme | Domains Affected |
|---|-------|-----------------|
| 1 | Missing input validation and rate limiting on public endpoints | API, Server |
| 2 | Async race conditions from fire-and-forget patterns | Map, UI, API |
| 3 | Test coverage gaps on production-critical paths | Test, Server, UI |
| 4 | In-memory caches invisible across serverless instances | API, Map |
| 5 | Dead code and unused options creating false confidence | Trip, Map, Test |

---

## Codebase Statistics

| Metric | Value |
|--------|-------|
| Frontend source files (src/) | ~231 |
| Server source files (server/src/) | 25 |
| API route handlers | 27 |
| Zustand stores | 5 |
| Custom hooks | 20+ |
| Analytics components | 14 (16 files) |
| Map hooks | 5 |
| Map utility modules | 6 |
| Test files | 44 |
| Test count (reported) | 662 |
| Test count (effective, excluding CSV-dump tests) | ~650 |
| Server test coverage | 1 file (14 tests) |
| Analytics test coverage | 0% |
| Socket.IO path test coverage | 0% |

---

## Strengths

**Architecture and Design**
- Clean layered separation throughout: ingestion loops, namespace handlers, API routes, hooks, stores, and components each have clear boundaries.
- The `(stationId, routeId)` node model for the transit graph is the standard multi-modal shortest-path formulation, correctly implemented.
- Graceful degradation across all four optional services (Redis, Neo4j, DynamoDB, S3/Bedrock) is consistent and correct -- every dependency check returns null and continues without it.
- The dual-mode data pipeline (Socket.IO push with React Query polling fallback) is well-engineered for resilience. Feature flags control fallback transparently.

**Production Quality Patterns**
- Shutdown sequence in the WS server is complete: ingestion loops stop, analytics flush, Socket.IO and HTTP close, all connections drain with a 10-second hard timeout.
- Pino structured logging with per-module child loggers throughout the server.
- DynamoDB batch writer correctly chunks at 25 items with exponential backoff retry.
- Reservoir sampling for median headway in metrics-collector avoids unbounded array growth.
- Redis cache-aside strategy is sound where applied (trains, alerts, arrivals, trip).
- Neo4j `withSession()` closes sessions in a `finally` block.

**Code Quality**
- TypeScript types are thorough. The trip planner type definitions, WS event contracts, and store interfaces are well-defined.
- Static GTFS file caches (`loadStops`, `loadRoutes`, `loadTrips`) use correct module-level lazy-load singleton patterns.
- shadcn/ui primitives used consistently with Tailwind CSS 4 and CVA variants.
- `cn()` utility for class merging (clsx + tailwind-merge) is used uniformly.
- The animation pipeline (alpha-beta-gamma filter + schedule-based fallback lerp) is a sophisticated and thoughtful design.
- Validation schemas in `src/lib/validation/schemas.ts` are precisely defined.
- The `flushing` mutex in metrics-collector correctly prevents concurrent flush execution.

**Test Infrastructure Foundations**
- Well-organized `src/test/` directory with factories, helpers, mocks, and a React Query wrapper.
- 662 tests across stores, hooks, core utility libraries, and UI components.
- CI pipeline runs lint, test, build checks for both app and server packages.

---

## Critical Issues

### CRIT-01 [API] Internal error messages forwarded verbatim to clients -- information leakage

All routes using `internalError(error instanceof Error ? error.message : '...')` pass raw exception messages -- which can contain stack traces, file paths, internal hostnames, Redis URLs, or Prisma query strings -- directly into the JSON response body. Affects 9 route handlers: `feed/[groupId]`, `trains`, `alerts`, `arrivals/[groupId]/[stopId]`, `arrivals/station/[stationId]`, `trip`, `routes`, `routes/[routeId]/stops`, `stops/[stopId]`.

**Affected files:** All route handlers in `src/app/api/v1/` using the `internalError(error.message)` pattern.

---

### CRIT-02 [API] `conductor/announce` -- unbounded in-memory audio cache across serverless instances

The `audioCache` Map stores base64 audio payloads (50-150 KB each) with a size-100 eviction threshold. On Vercel serverless, each instance has its own module scope, so the cache never warms across requests. A burst of 100 entries consumes ~10 MB per Lambda instance. Cache keys include `undefined` tokens when `direction` or `headsign` are missing, muddying deduplication.

**Affected file:** `src/app/api/v1/conductor/announce/route.ts`

---

### CRIT-03 [API] Rate limiting applied to only 4 of 27 route handlers

The rate-limiting infrastructure (`src/lib/rate-limit.ts`) is complete and well-designed, but only wired into 4 routes (conductor/announce, news, weather, stops). The remaining 23 routes -- including `/trains` (which fans out to all 8 MTA GTFS-RT feeds), `/trip` (which hits Neo4j), and all `/arrivals` endpoints -- have no request throttling. An unauthenticated client can issue unlimited parallel requests.

**Affected files:** All route handlers in `src/app/api/v1/` except the 4 listed above.

---

### CRIT-04 [API] Two `calculateDelay` / `clearScheduleCache` implementations with different semantics

Both `src/lib/mta/schedule-lookup.ts` and `src/lib/mta/load-schedule.ts` export functions with the same name but different behavior. The `schedule-lookup.ts` version uses a three-tier lookup with shape/direction fallback; `load-schedule.ts` uses a simpler cache. The inconsistency means delay calculations for the same trip return different values depending on which module is called. The `load-schedule.ts` version also has a midnight-crossing bug for GTFS times past 24:00:00.

**Affected files:** `src/lib/mta/schedule-lookup.ts`, `src/lib/mta/load-schedule.ts`

---

### CRIT-05 [API] `poi/nearby` -- no validation or bounds check on coordinates or category

`parseFloat` accepts any numeric string without coordinate range validation. A caller can pass `lat=9999` and the request reaches TomTom with malformed coordinates. The `category` parameter is passed unvalidated directly to TomTom's `categorySet` query parameter. TomTom expects numeric category IDs but any string is accepted.

**Affected file:** `src/app/api/v1/poi/nearby/route.ts`

---

### CRIT-06 [Map] Race condition: `updateApiData` async loop has no cancellation guard

The `useEffect` at line 199 of `useTrainMarkers.ts` fires a fire-and-forget async function on every `trains` prop change (every 15s). If the component unmounts or `trains` changes while a prior invocation is still awaiting, the stale async chain continues writing into `latestApiDataRef.current` after the map has been torn down.

**Affected file:** `src/components/map/hooks/useTrainMarkers.ts`

---

### CRIT-07 [Map] Race condition: `void Promise.all(displayTrains.map(async ...))` runs across effect boundaries

The main marker update effect dispatches a `void Promise.all(...)` and never cancels it. If the `trains` array changes before all async `createMotionState` calls complete, two overlapping async chains concurrently write to `trainMotionRef.current` and `trainAnimsRef.current` for the same `tripId`, creating DOM-detached phantom markers with permanently registered click listeners.

**Affected file:** `src/components/map/hooks/useTrainMarkers.ts`

---

### CRIT-08 [Map] Memory leak: train event listeners never explicitly removed

`createMotionState` and `createLegacyMarker` each attach three DOM event listeners (`mouseenter`, `mouseleave`, `click`) to the marker element using anonymous arrow functions. Because references are not stored, `removeEventListener` cannot be called on cleanup. The `click` handler closes over `setSelectedTrain`, keeping the React callback alive.

**Affected file:** `src/components/map/hooks/useTrainMarkers.ts`

---

### CRIT-09 [Map] `TripMarkers.tsx` `clearMarkers` is not stable and causes double-clear on unmount

`clearMarkers` is defined as a plain function inside the component body, not wrapped in `useCallback`. It is called from two `useEffect` hooks. On unmount, both cleanup callbacks fire, and the second call iterates an already-emptied `markersRef.current`. The deeper risk is that `clearMarkers` called mid-render-cycle truncates a partially-populated markers list.

**Affected file:** `src/components/map/hooks/TripMarkers.tsx`

---

### CRIT-10 [Trip] `preferFewerTransfers` is a dead option -- broken API contract

`DEFAULT_OPTIONS` sets `preferFewerTransfers: true`, and the option is accepted through the API route, but the Dijkstra implementation never reads this field. The algorithm always minimizes total cost. Callers who rely on `preferFewerTransfers: false` to get the time-optimal path regardless of transfers receive the same result as `true`.

**Affected files:** `src/lib/trip-planner/dijkstra.ts`, `src/lib/trip-planner/types.ts`

---

### CRIT-11 [Trip] `stops.txt` CSV parser breaks on quoted fields containing commas

The graph builder splits CSV lines on `,` with no accommodation for quoted fields. MTA station names can contain commas in quoted CSV format. A naively split line pushes every subsequent column off by one, causing `lat`/`lon` to parse as `NaN` and silently dropping entire stations from the graph.

**Affected file:** `src/lib/trip-planner/graph-builder.ts`

---

### CRIT-12 [Trip] `TripPlanResponse` type missing `backend` and `cached` fields

The API response includes `backend: 'neo4j' | 'in-memory'` and `cached: true` in the JSON, but `TripPlanResponse` in `types.ts` declares only `trips`, `origin`, `destination`, and `requestedAt`. Any future code reading `data.backend` gets `undefined` at runtime with no TypeScript error.

**Affected files:** `src/lib/trip-planner/types.ts`, `src/app/api/v1/trip/route.ts`

---

### CRIT-13 [Trip] Stale-entry reads from the priority queue are not guarded correctly

The Dijkstra implementation uses lazy deletion but the guard at line 164 compares `currentDist` (read as `dist.get(currentKey)!`) against `dist.get(currentKey)` -- always equal, so the check is dead code. The loop processes every inserted duplicate. Harmless at NYC subway scale (~500 nodes) but an algorithmic correctness issue.

**Affected file:** `src/lib/trip-planner/dijkstra.ts`

---

### CRIT-14 [UI] Station detail page bypasses React Query -- raw fetch + setInterval creates memory-leak risk

The `/stations/[stationId]/page.tsx` manages arrival data with `useState` + raw `setInterval(fetchArrivals, 30000)` instead of using the existing `useArrivals` hook. If the component unmounts between fetch resolution and state update, React warns about unmounted state updates. If `station` changes identity, duplicate polling intervals are created.

**Affected file:** `src/app/(dashboard)/stations/[stationId]/page.tsx`

---

### CRIT-15 [UI] Multiple analytics components issue duplicate Apollo `useDailyRollups` requests

Seven analytics components independently call `useDailyRollups(from, to)` with identical date ranges, each firing its own Apollo query. With `cache-and-network` fetch policy, this produces up to 7 simultaneous identical GraphQL requests on analytics page load. Risks AppSync cost and rate-limit exposure.

**Affected files:** `DelayTrendChart.tsx`, `BunchingGapTrendChart.tsx`, `RoutePerformanceTable.tsx`, `DelayDistributionChart.tsx`, `SystemHealthTimeline.tsx`, `BestWorstRouteCard.tsx`, `TripCompletionChart.tsx`

---

### CRIT-16 [UI] ApolloProvider wraps the entire app but is used only on the analytics page

The `ApolloProvider` is placed in the root layout, wrapping every page with the Apollo client and its InMemoryCache. GraphQL/AppSync is only consumed by analytics hooks. The Apollo client is a module-level singleton included in every page's JS bundle.

**Affected file:** `src/app/layout.tsx`, `src/lib/graphql/client.ts`

---

### CRIT-17 [Server] `activeTripMap` stale-trip cleanup runs before DynamoDB write -- trip end events lost on write failure

The stale-trip loop deletes entries from `activeTripMap` and appends `TRIP_END` events before the `try { await Promise.all([...]) }` write block. If `writeEvents` throws, the `activeTripMap` deletions have already happened and the TRIP_END events are lost. The `buffers.clear()` fix was correctly moved inside the try-success path, but stale-trip cleanup was not similarly guarded.

**Affected file:** `server/src/analytics/metrics-collector.ts`

---

### CRIT-18 [Test] Console.log CSV-dump tests inflate test count and give false confidence

`real-data.test.ts` and `train-state-machine.test.ts` contain test cases that are almost entirely `console.log` CSV dumps with a single trivial assertion (e.g., `expect(stops.size).toBeGreaterThan(0)`). The motion planner, alpha-beta-gamma filter, cluster engine, track index, and arclength modules all have zero deterministic coverage. Map animation regressions are invisible.

**Affected files:** `src/lib/map/real-data.test.ts`, `src/lib/map/train-state-machine.test.ts`

---

### CRIT-19 [Test] Socket.IO dual-mode hooks have 0% test coverage for their production path

The v2 architecture added a critical branch in `use-train-positions`, `use-alerts`, and `use-arrivals`: when `NEXT_PUBLIC_WS_URL` is set, the hook subscribes to Socket.IO and ignores React Query. This is the production path on EC2. It has no tests at all. The existing hook tests mock `global.fetch` and exercise only the polling path.

**Affected files:** `src/hooks/use-train-positions.ts`, `src/hooks/use-alerts.ts`, `src/hooks/use-arrivals.ts`, `src/components/providers/SocketProvider.tsx`

---

### CRIT-20 [Test] Redis mock `set()` signature does not match ioredis v5

The mock accepts `(key, value, mode?, ttl?)` but ioredis v5 uses `set(key, value, 'EX', seconds)`. The mock silently accepts the call without applying TTL correctly, masking cache expiry test failures.

**Affected file:** `src/test/mocks/redis-mock.ts`

---

### CRIT-21 [Test] Test documents a known bug without fixing it -- `getTextColorForBackground` case sensitivity

The test at line 135 of `format.test.ts` acknowledges the function is case-sensitive with the comment `"doesn't match - case sensitive"` while MTA constants store colors without the `#` prefix. This documents a defect rather than intended behavior.

**Affected file:** `src/lib/mta/format.test.ts`

---

## Important Issues

### IMP-01 [API] `axios` used in `fetch-feed.ts` and `fetch-alerts.ts` -- inconsistent HTTP client

Every other network call uses native `fetch`. `axios` is an extra ~50 KB dependency that prevents use of Next.js fetch instrumentation and cache directives. Both usages can be replaced with `fetch` + `arrayBuffer()` / `json()`.

**Affected files:** `src/lib/mta/fetch-feed.ts`, `src/lib/mta/fetch-alerts.ts`

---

### IMP-02 [API] `routeToFeedGroup` in `trains/route.ts` duplicates and diverges from `getFeedGroupForRoute`

The private function is a hand-rolled copy of `src/lib/mta/feed-groups.ts:getFeedGroupForRoute()` but handles different route aliases (`SIR`, `GS`, `FS`, `H`). The `FEED_GROUPS` config is missing these aliases, causing trains on those routes to be silently dropped from cache write-back.

**Affected files:** `src/app/api/v1/trains/route.ts`, `src/lib/mta/feed-groups.ts`

---

### IMP-03 [API] No validation of `stationId` path parameter in arrivals routes

The `stationId` flows directly into `getArrivalsForStop` and Redis key construction without format validation. The `stationIdSchema` in `src/lib/validation/schemas.ts` already exists but is not wired into the arrivals route handlers. Same applies to `groupId` and `stopId` in `arrivals/[groupId]/[stopId]/route.ts`.

**Affected files:** `src/app/api/v1/arrivals/station/[stationId]/route.ts`, `src/app/api/v1/arrivals/[groupId]/[stopId]/route.ts`

---

### IMP-04 [API] `fetch-alerts.ts` -- `resolveStopNames` called inside a hot loop with O(n^2) deduplication

`resolveStopNames` is called per-entity with `await` inside the loop, serializing what could be a batch operation. Inside, `!names.includes(name)` performs O(n) linear scans for deduplication.

**Affected file:** `src/lib/mta/fetch-alerts.ts`

---

### IMP-05 [API] User-controlled text injected verbatim into OpenAI prompt -- prompt injection risk

The conductor/announce route interpolates `stationName`, `headsign`, `poiName`, `crossStreet`, and `direction` directly into the OpenAI chat prompt. Length limits (200 chars) reduce but do not eliminate prompt injection risk.

**Affected file:** `src/app/api/v1/conductor/announce/route.ts`

---

### IMP-06 [API] `cron/cleanup/route.ts` -- misleading name and no actual cleanup

The handler performs only a health check (DescribeTable + DescribeTimeToLiveCommand) but is named `cleanup`, implying a destructive/maintenance operation.

**Affected file:** `src/app/api/cron/cleanup/route.ts`

---

### IMP-07 [API] `trains/route.ts` -- partial Redis cache miss triggers full MTA re-fetch

When any single feed group is missing from Redis, all cached groups are discarded and all eight MTA feeds are re-fetched. A single slow feed group forces a cold path that amplifies load on MTA and adds latency.

**Affected file:** `src/app/api/v1/trains/route.ts`

---

### IMP-08 [API] `calculateDelaysBatch` awaits serially inside a loop (N+1 async pattern)

Each arrival in the batch triggers a sequential `await calculateDelay(...)` call. After the first call the data is cached, but the serial `await` chain creates unnecessary microtask overhead for batches of 100+ arrivals.

**Affected file:** `src/lib/mta/schedule-lookup.ts`

---

### IMP-09 [API] RSS fetch in `conductor/news/route.ts` has no timeout and no error status check

No `AbortSignal.timeout()` guard. If RSS endpoints hang, the serverless function blocks until platform timeout. `response.text()` is called without checking `response.ok` -- a 429 or 503 results in sending error HTML to OpenAI.

**Affected file:** `src/app/api/v1/conductor/news/route.ts`

---

### IMP-10 [API] `equipment/route.ts` -- in-process module-level cache invisible across Vercel instances

Same pattern as `poi/nearby/route.ts`. The in-memory cache provides zero benefit in a multi-instance deployment and creates race conditions on the first request. Should use Redis.

**Affected file:** `src/app/api/v1/equipment/route.ts`

---

### IMP-11 [Map] Orphaned module-level `refreshInterval` constant and out-of-scope reference

A bare `const refreshInterval = 15000;` at line 1084 is dead code. `createMotionState` references this constant instead of the caller's parameter, so a refresh interval change at the call site would be silently ignored.

**Affected file:** `src/components/map/hooks/useTrainMarkers.ts`

---

### IMP-12 [Map] `isAnimatingRef` not reset on cleanup in `useMapAnimation.ts`

If the map unmounts while animation is running, `isAnimatingRef.current` remains `true`. On the next mount (hot reload, StrictMode), `scheduleAnimation` returns early and animation never restarts.

**Affected file:** `src/components/map/hooks/useMapAnimation.ts`

---

### IMP-13 [Map] `SubwayMap.tsx` passes `map.current` snapshot to hooks, not the ref object

All hooks receive `map.current` (a snapshot at render time) rather than `map` (the ref object). If the map ref is reassigned on cleanup/re-creation (StrictMode double-invocation), hooks hold a stale reference to a destroyed map.

**Affected file:** `src/components/map/SubwayMap.tsx`

---

### IMP-14 [Map] `useTripRouteLayer.ts` -- async GeoJSON result applied without mount guard

The `.then()` callback captures `source` before the await. If `selectedTrip` changes or the component unmounts while resolving, `source.setData` is called on a potentially removed source.

**Affected file:** `src/components/map/hooks/useTripRouteLayer.ts`

---

### IMP-15 [Map] `useStationMarkers.ts` -- `selectedStationId` closure stale in `handleClick`

`handleClick` closes over `selectedStationId` at marker creation time and is never re-created. Clicking a second station will not deselect the first because the handler uses the stale initial value.

**Affected file:** `src/components/map/hooks/useStationMarkers.ts`

---

### IMP-16 [Map] `track-index.ts` -- fragile CSV parsing for `stops.txt`

The parser splits on `,` with no accommodation for quoted fields. MTA `stops.txt` can contain commas in stop names. A stop name with a comma shifts `lat`/`lon` columns, producing `NaN` coordinates and silently dropping the stop.

**Affected file:** `src/lib/map/track-index.ts`

*Note: This is the same CSV parsing vulnerability as CRIT-11, manifesting in a different module that independently parses the same file.*

---

### IMP-17 [Map] RAF loop and React effect mutate the same `TrainMotionState` objects concurrently

The animation loop directly mutates `state.filter.s`, `state.lastRenderedS`, etc. while `useTrainMarkers`' effect writes `state.lastApiUpdate`, `state.prevTimeMs` to the same objects. No synchronization exists between the RAF callback and the React effect -- a TOCTOU hazard on low-end devices.

**Affected file:** `src/components/map/hooks/useMapAnimation.ts`, `src/components/map/hooks/useTrainMarkers.ts`

---

### IMP-18 [Trip] `findAlternativePaths` is not Yen's algorithm -- uses random sampling

The comment says "Yen's algorithm variant" but the implementation randomly excludes routes from the first path's route set. Results are non-deterministic (`Math.random()`), often return only one path, and do not guarantee genuinely distinct shortest paths.

**Affected file:** `src/lib/trip-planner/dijkstra.ts`

---

### IMP-19 [Trip] Neo4j Cypher `shortestPath` minimizes hops, not travel time

`shortestPath` finds the path with fewest relationships. The `reduce(...) ORDER BY totalCost` clause re-ranks after the fact but the time-optimal path may have already been discarded. Returns suboptimal results compared to the in-memory Dijkstra fallback.

**Affected files:** `src/lib/trip-planner/neo4j-planner.ts`, `server/src/lib/queries/trip-planner.ts`

*Note: This finding appears in both the Trip Planner and Server reviews.*

---

### IMP-20 [Trip] `transferType` heuristic in Neo4j path converter is wrong

`relProps.walkTime` may not exist (the actual field is `relProps.duration`). `toNumber(undefined)` returns `0`, which is never `> 120`, so all transfers are classified as `in-system` regardless of actual walk time.

**Affected file:** `src/lib/trip-planner/neo4j-planner.ts`

---

### IMP-21 [Trip] Graph builder adds duplicate reverse transfer edges

The `alreadyHasEdge` duplicate check only inspects the forward direction. If `transfer-graph.json` already contains a reverse edge, a second reverse edge is added, inflating the edge count.

**Affected file:** `src/lib/trip-planner/graph-builder.ts`

---

### IMP-22 [Trip] `use-trip-planner.ts` calls `fetch` directly instead of `apiClient`/TanStack Query

The hook bypasses request interceptors, base URL config, retry logic, and TanStack Query caching. Every `planTrip()` call is a fresh network request with no devtools visibility.

**Affected file:** `src/hooks/use-trip-planner.ts`

---

### IMP-23 [Trip] `reset()` in the trip store does not reset `isPanelOpen`

Calling `reset()` preserves panel state. This is inconsistent: `reset()` is described as a full reset but leaves the panel open.

**Affected file:** `src/stores/trip-store.ts`

---

### IMP-24 [Trip] `createDoubleTransferPath` fixture is defined but unused

The fixture exists for testing consecutive transfer edges, but no test file imports or uses it. The `convertPathToTrip` logic for consecutive transfers is therefore untested.

**Affected file:** `src/lib/trip-planner/__tests__/mock-paths.ts`

---

### IMP-25 [UI] `useOperationalStats` calls three hooks causing cascading re-renders

Internally calls `useAnalytics()`, `useAlerts()`, and `useDailyRollups()`. The `useAnalytics` hook polls every 15 seconds, causing `OperationalStatsBar` to re-render at map polling cadence even when displayed values are unchanged.

**Affected file:** `src/hooks/use-operational-stats.ts`

---

### IMP-26 [UI] `useAlerts` instantiated 5+ times on the analytics page without data sharing

Each instance runs its own `useMemo` for `activeAlerts`, `visibleAlerts`, and `counts`. With ~100+ service alerts, five separate passes through the alert array run per polling cycle.

**Affected files:** `AlertStatusCard.tsx`, `AlertBanner.tsx`, `AlertBadge.tsx`, `AppSidebar.tsx`, analytics page

---

### IMP-27 [UI] `AlertsUIState` uses `Set<string>` in Zustand -- `persist` would silently drop it

`JSON.stringify(new Set(['a', 'b']))` produces `{}`. If persistence is added to the alerts store (natural for dismissed alerts), the data silently vanishes on page load.

**Affected file:** `src/stores/alerts-store.ts`

---

### IMP-28 [UI] `useCanPlanTrip` and `useSelectedTrip` each create multiple Zustand subscriptions

`useCanPlanTrip` creates three independent subscriptions. Each subscription triggers independent re-renders. Should use a single combined selector with shallow equality.

**Affected file:** `src/stores/trip-store.ts`

---

### IMP-29 [UI] `useGeolocationStore` stores `watchId` in Zustand state

The geolocation watch ID is a side-effect resource handle, not UI state. Every `set({ watchId })` call triggers unnecessary re-renders of all subscribers.

**Affected file:** `src/stores/geolocation-store.ts`

---

### IMP-30 [UI] `use-transit-analysis`, `use-anomaly-feed`, and `use-trip-planner` call raw `fetch` directly

Bypasses the project's `mtaApi` abstraction, error normalization, and testability via mocks.

**Affected files:** `src/hooks/use-transit-analysis.ts`, `src/hooks/use-anomaly-feed.ts`, `src/hooks/use-trip-planner.ts`

---

### IMP-31 [UI] `useBackgroundSync` creates competing `setInterval` for trains data

On the stations page, trains data is fetched at both 15-second intervals (via `useTrainPositions`) and 30-second prefetch intervals (via `useBackgroundSync`). The background interval is completely redundant.

**Affected file:** `src/hooks/use-background-sync.ts`

---

### IMP-32 [UI] Date range recomputed on every render without memoization in 6 analytics components

`new Date()` called at the top of the render function for date strings that only change at midnight. Creates new variable object references each render across `DelayTrendChart`, `BunchingGapTrendChart`, `RoutePerformanceTable`, `DelayDistributionChart`, `SystemHealthTimeline`, `BestWorstRouteCard`.

**Affected files:** All 6 analytics chart components listed above.

---

### IMP-33 [UI] AlertBanner ticker restarts from beginning on un-pause instead of resuming

When the user un-hovers, the ticker jumps back to `x: 0` rather than resuming from where it stopped.

**Affected file:** `src/components/alerts/AlertBanner.tsx`

---

### IMP-34 [UI] `StationSearch` dropdown has no keyboard navigation or ARIA combobox semantics

No `role="listbox"`, no `aria-expanded`, no `aria-activedescendant`, no arrow-key navigation. Screen reader users cannot navigate results. The shadcn `Command` component would handle all of this automatically.

**Affected file:** `src/components/trip-planner/StationSearch.tsx`

---

### IMP-35 [UI] `ErrorBoundary` does not report errors to any observability sink

Errors only logged to `console.error`. No integration with Sentry, Vercel Analytics, or any other error tracking. Errors hitting the boundary in production are invisible.

**Affected file:** `src/components/ErrorBoundary.tsx`

---

### IMP-36 [UI] `use-analytics.ts` timeline data is fabricated

Creates 12 identical time slots using only the current train count. Exported as `data.timeline` which could mislead future consumers into displaying fabricated historical data.

**Affected file:** `src/hooks/use-analytics.ts`

---

### IMP-37 [UI] `useMultiStationArrivals` uses a hardcoded non-namespaced query key

`['multi-arrivals', station.id]` bypasses the centralized `queryKeys` registry, making it invisible to cache invalidation strategies.

**Affected file:** `src/hooks/use-multi-station-arrivals.ts`

---

### IMP-38 [UI] `AnomalyFeed` event list key includes array index, harming React reconciliation

`key={`${event.pk}-${event.timestamp}-${i}`}` -- the index prevents DOM node reuse when the array is sorted or filtered.

**Affected file:** `src/components/analytics/AnomalyFeed.tsx`

---

### IMP-39 [Server] No Socket.IO connection authentication -- any origin can subscribe

Socket.IO namespaces accept connections without auth. Non-browser clients bypass CORS entirely and can subscribe to any room, streaming all real-time train positions.

**Affected files:** `server/src/namespaces/trains.ts`, `alerts.ts`, `arrivals.ts`

---

### IMP-40 [Server] No input length bounding on Socket.IO subscription payloads

All three handlers validate `typeof x === "string"` but do not cap string length. A client sending a 1 MB `routeId` creates a 1 MB room name in the Socket.IO room registry -- a memory exhaustion vector.

**Affected files:** `server/src/namespaces/trains.ts`, `alerts.ts`, `arrivals.ts`

---

### IMP-41 [Server] Alert loop does not send MTA API key

The feed loop correctly attaches `x-api-key`. The alert loop does not. If MTA begins enforcing the key on the alerts endpoint, alerts will silently stop updating.

**Affected file:** `server/src/ingestion/alert-loop.ts`

---

### IMP-42 [Server] No `unhandledRejection` / `uncaughtException` handlers

`SIGINT` and `SIGTERM` are handled, but unhandled promise rejections crash Node.js silently with no structured log.

**Affected file:** `server/src/index.ts`

---

### IMP-43 [Server] Timeout classification misses `ETIMEDOUT`

Only `ECONNABORTED` is checked. A hung TCP handshake produces `ETIMEDOUT`, which is misclassified as a generic error instead of a timeout.

**Affected file:** `server/src/ingestion/feed-loop.ts`

---

### IMP-44 [Server] `seed-neo4j.ts` uses `CREATE` not `MERGE` -- re-running throws constraint violations

All node-creation statements use `CREATE`. Running the script a second time without `--clean` hits unique constraints and leaves the graph in a partial state.

**Affected file:** `server/src/scripts/seed-neo4j.ts`

---

### IMP-45 [Server] `transit-analyzer.ts` `toMin` function uses non-obvious division formula

`Math.round(seconds / 6) / 10` is mathematically correct (equivalent to `/60` with 1 decimal place) but the non-obvious form is a maintenance hazard.

**Affected file:** `server/src/analytics/transit-analyzer.ts`

---

### IMP-46 [Server] Alert loop uses `setInterval` while feed loop uses self-scheduling `setTimeout`

The feed loop correctly uses self-scheduling `setTimeout` to prevent overlap. The alert loop uses `setInterval`, creating overlap risk if a fetch is slow.

**Affected file:** `server/src/ingestion/alert-loop.ts`

---

### IMP-47 [Test] "Integration" test files are misnamed and duplicate unit tests

Both files in `src/__tests__/integration/` test a single Zustand store action -- the exact same operations tested in `trains-store.test.ts`. They contain no HTTP calls, no component rendering, and no real integration.

**Affected files:** `src/__tests__/integration/train-tracking.test.ts`, `src/__tests__/integration/station-arrivals.test.ts`

---

### IMP-48 [Test] No coverage thresholds in vitest config; debug tests not excluded

Running `test:coverage` includes filesystem-reading diagnostic tests. No thresholds configured, so 0% line coverage on new files passes CI.

**Affected file:** `vitest.config.ts`

---

### IMP-49 [Test] `QueryWrapper` creates a new `QueryClient` on every render

If a test causes the wrapper to re-render, a fresh client is created and all cached data is lost, potentially causing a second fetch that interferes with mock call counts.

**Affected file:** `src/test/utils/query-wrapper.tsx`

---

### IMP-50 [Test] All 16 analytics components have 0% test coverage

The entire `src/components/analytics/` directory has no tests. This is a recently delivered major feature. Loading, empty, and error states are untested.

**Affected directory:** `src/components/analytics/`

---

### IMP-51 [Test] `geolocation-store.ts` has 0% test coverage

The only Zustand store without tests. Drives the "Near Me" feature and `NearbyArrivalsWidget`.

**Affected file:** `src/stores/geolocation-store.ts`

---

### IMP-52 [Test] Multiple API routes have 0% test coverage

Includes the highest-traffic endpoint (`/api/v1/trains`), plus `equipment`, `schedule`, `routes/[routeId]/stops`, `stops/[stopId]`, `poi/nearby`, `cron/collect`, `cron/cleanup`, `conductor/announce`, and `health`.

**Affected files:** 10 API route handlers listed above.

---

### IMP-53 [Test] Prisma mock frozen at two models with no reset-to-defaults

After `mockReset()`, `findMany` returns `undefined` instead of `[]`. New Prisma models are silently absent from the mock.

**Affected file:** `src/test/mocks/prisma-mock.ts`

---

### IMP-54 [Test] `src/middleware.ts` has disabled rate limiter with no test

The middleware is a no-op (`NextResponse.next()` always). The rate-limiting integration point has never been wired up or tested.

**Affected file:** `src/middleware.ts`

---

### IMP-55 [Test] `train-state-machine.test.ts` mixes debugging CSV output with critical regression tests

Three of seven `it()` blocks produce CSV output with no assertions. Two other tests are genuine critical regression tests. These should be separated.

**Affected file:** `src/lib/map/train-state-machine.test.ts`

---

### IMP-56 [Test] Server vitest config runs no tests; server has 0% test coverage

`server/vitest.config.ts` scans `src/__tests__/` but no such directory exists. CI runs only `tsc --noEmit` and `npm run build` for the server. The entire feed ingestion, Redis pub/sub, and Neo4j trip planning has zero test coverage.

**Affected files:** `server/vitest.config.ts`, `.github/workflows/ci.yml`

---

## Minor Issues

### Theme: Code Duplication and Dead Code

**MIN-01 [Map]** `createPopupHTML` in `useTrainMarkers.ts` and `createPopupHTMLForAnimation` in `useMapAnimation.ts` are near-identical (~100 lines duplicated). Extract to shared utility.

**MIN-02 [Map]** `haversineDistance` implemented independently in both `src/lib/geo/nearest-stations.ts` and `src/lib/map/track-index.ts`. Consolidate to one canonical export.

**MIN-03 [Trip]** `createDoubleTransferPath` fixture exists but is never imported by any test (also noted as IMP-24).

**MIN-04 [Trip]** `findAlternativePaths` accumulates routes but deletes `routeToAvoid` whether or not the alternative succeeded, permanently shrinking the avoidance set.

**MIN-05 [Trip]** `avoidRoutes` case-insensitivity test passes identical values twice instead of testing actual case variation.

**MIN-06 [Trip]** `path-converter.test.ts` imports `beforeEach` at the bottom of the file instead of the top.

**MIN-07 [UI]** `AlertList` has redundant `?? []` fallback after an early return that guarantees non-empty array.

**MIN-08 [UI]** `TransitAnalysisCard` has a dead code path where `(!data && !isLoading)` and `!data` branches overlap confusingly.

---

### Theme: Operator Precedence, Naming, and Style

**MIN-09 [API]** `fetch-feed.ts` line 91: `sId && stopDict[sId]?.name || null` is confusing operator precedence. Use `sId ? (stopDict[sId]?.name ?? null) : null`.

**MIN-10 [API]** `trip/route.ts` cache key includes unsanitized user input (`origin`, `destination` without format validation).

**MIN-11 [API]** `health/route.ts` returns service name string without authentication (minor information disclosure).

**MIN-12 [API]** `conductor/announce/route.ts` uses `"gpt-4.1-mini"` while news/weather routes use `"gpt-4o-mini"` -- possible typo or intentional model split.

**MIN-13 [API]** `load-stop-times.ts` `scheduleDataCache` not invalidated on service day change for long-running processes.

**MIN-14 [API]** `mtaApi.getAlerts` builds URL with unencoded route IDs. Use `URLSearchParams`.

**MIN-15 [API]** Two separate `src/lib/rate-limit.ts` and `src/lib/api/rate-limit.ts` modules with incompatible interfaces (`allowed` vs `success`).

---

### Theme: Accessibility and UX

**MIN-16 [UI]** `StationCard` uses `<span role="button">` instead of a real `<button>` element.

**MIN-17 [UI]** `EquipmentStatusCard` inline SVG has no `aria-hidden` or `aria-label`.

**MIN-18 [UI]** `RoutePerformanceTable` uses IIFE inside JSX for grade rendering -- recreates closure per row per render.

**MIN-19 [UI]** `DelayDistributionChart.computeDistribution` uses a statistical approximation that is documented nowhere in the UI.

**MIN-20 [UI]** `html lang="en"` hardcoded to dark mode -- theme store toggle has no visual effect.

**MIN-21 [UI]** `SubwayMapModal` fetches PDF.js worker from unpkg CDN at runtime -- fragile for production.

---

### Theme: Map Animation and Rendering

**MIN-22 [Map]** Module-level mutable globals in `useTrainMarkers.ts` (seven `let` variables) should be grouped into a single typed interface.

**MIN-23 [Map]** `cluster-trains.ts` `getGridKey` comment should note non-isotropic grid cell size at different latitudes.

**MIN-24 [Map]** `MyLocationButton.tsx` `flyTo` fires on every GPS position update, not just the first activation.

**MIN-25 [Map]** `useUserLocationMarker.ts` injects `<style>` tag into `document.head` but never removes it. Should be in `globals.css`.

**MIN-26 [Map]** `arclengthToLatLon` returns `[lat, lon]` but no docstring clarifies this is not GeoJSON `[lon, lat]` order.

**MIN-27 [Map]** `SubwayMap.tsx` sets `mapLoaded(true)` before subway lines GeoJSON fetch completes, causing brief visual gap.

**MIN-28 [Map]** `use-train-positions-suspense.ts` does not integrate with Socket.IO path and is unused.

**MIN-29 [Map]** `track-index.ts` `flattenMultiLineString` silently drops shorter branches of branching routes (e.g., A train).

---

### Theme: Trip Planner

**MIN-30 [Trip]** `generateTripId` uses deprecated `String.prototype.substr`. Use `substring(2, 11)` or `crypto.randomUUID()`.

**MIN-31 [Trip]** `graph-builder.ts` edge-count log iterates all edge values for O(E) just for a log line.

**MIN-32 [Trip]** `TripSegment.direction` field declared but never populated by any code path.

---

### Theme: Server

**MIN-33 [Server]** `cache.ts` and `cache-keys.ts` define two separate `CACHE_KEYS` objects -- key namespace fragmentation.

**MIN-34 [Server]** `pino-pretty` is in `devDependencies` but needed when `NODE_ENV !== 'production'`. Staging environments fail.

**MIN-35 [Server]** Dockerfile production stage copies full `node_modules` including devDependencies (~80-120 MB unnecessary).

**MIN-36 [Server]** `schedule-lookup.ts` reads all of `stop_times.txt` (~35 MB) into a string on nightly rebuild -- double-peak memory.

**MIN-37 [Server]** `humanEta` produces `"0m ago"` for arrivals 31-59 seconds in the past.

---

### Theme: Test Infrastructure

**MIN-38 [Test]** `src/test/setup.ts` should add global `afterEach` with `vi.clearAllMocks()` for better test isolation.

**MIN-39 [Test]** Factory ID counter is module-global and never auto-reset between tests.

**MIN-40 [Test]** `helpers/index.ts` re-exports `waitFor` as `waitForElement` (deprecated API name), creating confusion.

**MIN-41 [Test]** `use-arrivals.test.ts` has a near-duplicate test.

**MIN-42 [Test]** `AlertBadge.test.tsx` and `AlertBanner.test.tsx` use `vi.waitFor` instead of `@testing-library/react`'s `waitFor`.

**MIN-43 [Test]** `next.config.ts` cache header values have no test.

**MIN-44 [Test]** CI does not run server tests -- only `tsc --noEmit` and `npm run build`.

**MIN-45 [Test]** `test:coverage` script does not specify coverage provider explicitly.

**MIN-46 [UI]** `use-mobile.ts` missing `'use client'` directive (inconsistency with all other hooks).

**MIN-47 [UI]** `AlertCard.formatTimeRange` defined as nested function inside component body, recreated every render.

**MIN-48 [UI]** Recharts tooltip `wrapperStyle={{ zIndex: 50 }}` hardcoded across 6 chart components -- should be a shared constant.

---

## Architecture Observations

### Dual Data-Client Architecture (Apollo + React Query)

The co-existence of Apollo Client (AppSync/GraphQL analytics) and React Query (REST/MTA data) is justified by the different backends, but creates friction. The two clients have separate caches with no cross-talk. `useOperationalStats` bridges them by reading from both, making it impossible to write a unified loading state. The `ApolloProvider` wrapping the entire app imposes bundle and memory overhead on non-analytics pages. The recommendation is to scope Apollo strictly to the analytics subtree and document the boundary clearly.

### Disabled State Machine in Map Animation

The `TrainAnimationState` in `useTrainMarkers.ts` is fully implemented but intentionally disabled (`const animState = null;`) due to a BOARDING phase bug. Production uses the simpler fallback lerp. Two animation paths are now partially maintained. The recommendation is either to fix the BOARDING bug and remove the fallback, or to remove the state machine entirely and accept the simpler system.

### Dual Ref Map in `useTrainMarkers`

Trains are tracked in either `trainAnimsRef` (legacy lerp) or `trainMotionRef` (arclength motion). Both maps are iterated in cleanup and display updates with duplication guards. A single unified marker map with a `type: 'motion' | 'legacy'` discriminant would improve readability.

### In-Memory Caches on Serverless

The Redis cache-aside strategy is correct where applied, but several routes (`equipment`, `poi/nearby`, `conductor/announce`) use in-process `Map` caches that are invisible across Vercel Lambda instances. Policy should be: Redis for cross-instance data; in-process caches only for immutable data (static GTFS files).

### Single-Instance Server Assumption

The WS server's module-level state (`previousTripIds`, `activeTripMap`, `subscriberCount`) is not externalized and would produce incorrect behavior with multiple instances. This is an acceptable single-instance design but must be documented to prevent accidental scale-out.

### Graph Model Simplification

The transit graph is undirected (both forward and reverse ride edges), which is a simplification since NYC subway travel times can differ by direction. Same `seconds` value is used in both directions. Acceptable approximation at current scale.

---

## Security Assessment

### API Layer

| Surface | Current State | Risk Level |
|---------|--------------|------------|
| Rate limiting | 4 of 27 routes protected | HIGH |
| Error messages | Raw exception messages returned to clients | HIGH |
| Input validation | Validation schemas exist but not wired to most routes | MEDIUM |
| Prompt injection | User input interpolated directly into OpenAI prompts | MEDIUM |
| Cache key pollution | Unsanitized user input in Redis cache keys | LOW |
| Health endpoint | Returns service name without auth | LOW |

### Server Layer

| Surface | Current State | Risk Level |
|---------|--------------|------------|
| Socket.IO auth | No token validation; any client can connect | HIGH |
| Input length | No bounds on subscription payloads | MEDIUM |
| HTTP CORS | Manual origin check, does not block non-browser | LOW |
| HTTP rate limiting | None on HTTP endpoints | MEDIUM |
| Redis credentials | In env var; confirm TLS in prod | LOW |
| MTA API key | Present in feed loop, missing in alert loop | LOW |

### Cross-Cutting

- Coordinate validation missing on `poi/nearby` -- malformed coordinates reach external TomTom API.
- `stationId`, `groupId`, `stopId` path parameters pass unvalidated through several API routes.
- `avoidRoutes` parameter in trip planner accepts unbounded-length strings.
- No `unhandledRejection` / `uncaughtException` handlers in the WS server.

---

## Performance Assessment

### Hot Paths

- **`/api/v1/trains` partial cache miss** (IMP-07): A single missing feed group discards all cached groups and re-fetches all 8 MTA feeds. Fix: return partial results and fetch only missing groups.
- **`calculateDelaysBatch` serial await** (IMP-08): 100 sequential async calls when data is already in memory. Fix: load data once, compute synchronously.
- **`resolveStopNames` O(n^2)** (IMP-04): Linear `includes()` scan for deduplication inside a hot loop. Fix: use `Set`.
- **`useOperationalStats` cascade** (IMP-25): Three hooks (one polling at 15s) trigger re-renders of the stats bar even when values are unchanged.
- **5+ `useAlerts` instances** (IMP-26): Five separate `useMemo` passes through ~100 alerts per polling cycle.
- **7 identical Apollo requests** (CRIT-15): Up to 7 simultaneous `useDailyRollups` queries on analytics page load.

### Bundle Size

- `axios` imported in 2 MTA files while the rest uses native `fetch` (~50 KB gzipped unnecessary).
- `ApolloProvider` + Apollo client included in every page bundle despite only analytics usage.

### Memory

- `conductor/announce` audio cache holds up to 10 MB of base64 in Lambda heap.
- `stop_times.txt` (~35 MB) read into a string during nightly rebuild creates double-peak memory.
- No `removeEventListener` on train markers accumulates closures (CRIT-08).

---

## Test Coverage Assessment

### Coverage by Domain

| Domain | Files Tested | Files Untested | Coverage Quality |
|--------|-------------|----------------|-----------------|
| Zustand stores | 4 of 5 | `geolocation-store` | Good |
| Custom hooks | 8+ | `use-operational-stats`, `use-background-sync`, `use-multi-station-arrivals` | Good (polling path only) |
| Trip planner algorithm | `dijkstra`, `graph-builder`, `path-converter` | Real-data diagnostic only | Good for core, gaps on edge cases |
| Map hooks | 0 | All 5 hooks | None |
| Map utilities | 0 (diagnostic-only tests) | `motion-planner`, `alpha-beta-gamma`, `cluster-trains`, `track-index`, `arclength` | None |
| Analytics components | 0 of 16 | All 16 | None |
| API routes | 4 | 10 untested (including `/trains`) | Partial |
| Server ingestion | 1 (position-archiver) | `feed-loop`, `metrics-collector`, `schedule-lookup`, `transit-analyzer`, all namespaces | Minimal |
| Socket.IO dual-mode path | 0 | `SocketProvider`, 3 dual-mode hooks | None -- production path untested |

### Structural Issues

- **Test count inflation**: CSV-dump tests in `real-data.test.ts` and `train-state-machine.test.ts` contribute ~10-15 test cases with no meaningful assertions.
- **Misnamed integration tests**: Both files in `src/__tests__/integration/` are unit tests duplicating `trains-store.test.ts`.
- **Mock drift**: Redis mock signature does not match ioredis v5. Prisma mock frozen at 2 models.
- **No coverage thresholds**: 0% line coverage on new files passes CI.
- **No server tests in CI**: Server CI job runs only typecheck and build.

### Highest-Risk Gaps

1. **Server feed ingestion** (`feed-loop.ts`) -- the most critical data path with zero tests.
2. **Socket.IO production path** -- the EC2 deployment path with zero tests.
3. **Analytics components** -- 16 recently delivered components with zero tests.
4. **Map hooks** -- the most complex frontend code (1,085 lines in `useTrainMarkers.ts` alone) with zero tests.
5. **`/api/v1/trains`** -- highest-traffic endpoint with zero tests.

---

## Overall Assessment and Recommendation

Railtime is a well-architected application with genuine engineering depth. The dual-mode data pipeline, the transit graph algorithm, the imperative MapLibre marker system, and the graceful degradation pattern are all substantial engineering accomplishments that work correctly in the common case.

The codebase is **not production-hardened**. The security surface (rate limiting, error leakage, Socket.IO auth, input validation) is the most urgent category. The map animation race conditions are the most complex to fix. The test coverage gaps are the most extensive -- particularly the zero-coverage production Socket.IO path and the server ingestion pipeline.

**Recommended priority sequence:**

1. **Security hardening** (CRIT-01, CRIT-03, IMP-39, IMP-40): Error message sanitization, rate limiting, Socket.IO auth, input validation. These are the highest-risk, lowest-effort fixes.
2. **Map race condition fixes** (CRIT-06, CRIT-07, CRIT-08): Add cancellation guards and event listener cleanup in `useTrainMarkers`. These are medium-effort but prevent real memory leaks and phantom markers.
3. **Algorithmic corrections** (CRIT-10, IMP-19): Fix or remove `preferFewerTransfers`, address Neo4j hop-vs-cost issue.
4. **Test coverage for production paths** (CRIT-18, CRIT-19, IMP-56): Socket.IO hook tests, server feed-loop tests, `/api/v1/trains` route test.
5. **Analytics architecture cleanup** (CRIT-15, CRIT-16): Lift shared data to page level, scope Apollo to analytics subtree.

The codebase is serviceable today and can continue operating, but the security and resilience issues should be addressed before any significant traffic growth or public launch.
