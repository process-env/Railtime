Last Updated: 2026-02-24

# Codebase Health Review -- Task List

---

## Summary

| Tier | API | Map | Trip | UI | Server | Test | Total |
|------|-----|-----|------|----|--------|------|-------|
| Tier 1: Critical | 5 | 4 | 4 | 3 | 1 | 4 | **21** |
| Tier 2: Important | 10 | 7 | 7 | 14 | 8 | 10 | **56** |
| Tier 3: Minor | 7 | 8 | 3 | 11 | 5 | 8 | **42** |
| Tier 4: Strategic | 2 | 2 | 2 | 2 | 2 | 2 | **12** |
| **Total** | **24** | **21** | **16** | **30** | **16** | **24** | **131** |

*Note: Some findings appear in multiple domain reviews. This task list is deduplicated -- each task appears once under its primary domain, with cross-references noted where applicable.*

---

## Tier 1: Critical -- Must Fix Before Next Production Push

### API & Data Pipeline

- [x] **CRIT-01** [API] Sanitize error messages returned to clients | Effort: **S**
  Change all `internalError(error.message)` calls to use static strings. 9 route handlers affected, 2-line change each. Prevents leakage of stack traces, hostnames, Redis URLs.

- [x] **CRIT-02** [API] Migrate `conductor/announce` audio cache from in-memory Map to Redis | Effort: **M**
  Replace `audioCache` Map with `getCache`/`setCache`. Fix `undefined` tokens in cache keys. Remove size-100 eviction in favor of Redis TTL.

- [x] **CRIT-03** [API] Wire rate limiting to remaining 23 route handlers | Effort: **M**
  Apply `checkRateLimit` / `getClientIdentifier` from `src/lib/rate-limit.ts` at the top of each unprotected handler. Infrastructure exists; only wiring is needed.

- [x] **CRIT-04** [API] Delete duplicate `calculateDelay` / `clearScheduleCache` in `load-schedule.ts` | Effort: **S**
  Verify no live consumers of `src/lib/mta/load-schedule.ts`, then remove. All callers should use `schedule-lookup.ts` exclusively.

- [x] **CRIT-05** [API] Add coordinate bounds and category validation to `poi/nearby` | Effort: **S**
  Add `lat` in `[-90, 90]`, `lon` in `[-180, 180]` guards and regex validation for numeric `category` format. Four lines of guard code.

### Map Components & Hooks

- [x] **CRIT-06** [Map] Add cancellation guard to `updateApiData` async loop in `useTrainMarkers.ts` | Effort: **S**
  Add `let cancelled = false` flag and check after each `await`. Return cleanup that sets `cancelled = true`.

- [x] **CRIT-07** [Map] Add cancellation guard to `void Promise.all(displayTrains.map(...))` in `useTrainMarkers.ts` | Effort: **M**
  Add a ref-based abort flag or serialization queue to prevent overlapping async chains from concurrently writing to marker refs.

- [x] **CRIT-08** [Map] Store and remove event listeners on train marker cleanup | Effort: **M**
  Store references to `mouseenter`, `mouseleave`, `click` handlers so `removeEventListener` can be called in `fadeOutAndRemove`. Follow the pattern from `useStationMarkers.ts`.

- [x] **CRIT-09** [Map] Fix `TripMarkers.tsx` `clearMarkers` instability and double-clear | Effort: **S**
  Wrap `clearMarkers` in `useCallback`, consolidate cleanup into a single unmount guard.

### Trip Planner Algorithm

- [x] **CRIT-10** [Trip] Fix or remove `preferFewerTransfers` option | Effort: **S**
  Either implement a secondary tiebreak on `transferCount` when costs are equal, or remove the option from all public surfaces (types, API route, defaults).

- [x] **CRIT-11** [Trip/Map] Replace naive CSV `split(',')` parser for `stops.txt` | Effort: **M**
  Affects `graph-builder.ts` (Trip) and `track-index.ts` (Map). Replace with a minimal RFC-4180 parser or pre-process CSV to JSON in the build script. *Cross-ref: IMP-16*

- [x] **CRIT-12** [Trip] Add `backend` and `cached` fields to `TripPlanResponse` type | Effort: **S**
  Extend the type with `backend?: 'neo4j' | 'in-memory'` and `cached?: boolean` to match the actual API response shape.

- [x] **CRIT-13** [Trip] Fix dead stale-entry guard in Dijkstra priority queue | Effort: **M**
  The `PriorityQueue` must expose extracted priority so the guard can compare it against `dist.get(currentKey)`. Alternatively, add a `visited` set.

### Frontend UI & State

- [x] **CRIT-14** [UI] Replace manual `fetch + setInterval` on station detail page with `useArrivals` hook | Effort: **S**
  Single-file change. Remove `useState` for arrivals, remove `fetchArrivals` callback and interval `useEffect`. Use existing `useArrivals` hook.

- [x] **CRIT-15** [UI] Lift `useDailyRollups` to analytics page level; pass data as props | Effort: **M**
  Call `useDailyRollups` once in `analytics/page.tsx` and pass `rollupData` to all 7 chart components. Eliminates up to 7 redundant Apollo requests per page load.

- [x] **CRIT-16** [UI] Move `ApolloProvider` from root layout to analytics subtree | Effort: **S**
  Create `app/(dashboard)/analytics/layout.tsx` wrapping only the analytics route with `ApolloProvider`. Remove from root `layout.tsx`.

### WebSocket Server

- [x] **CRIT-17** [Server] Move `activeTripMap` stale-trip deletion to inside the DynamoDB write try-success path | Effort: **S**
  Defer `activeTripMap.delete(tripId)` calls to after `Promise.all` succeeds, alongside the existing `buffers.clear()`.

### Test Infrastructure

- [ ] **CRIT-18** [Test] Replace console.log CSV-dump tests with deterministic unit tests | Effort: **L**
  Move diagnostic output from `real-data.test.ts` and `train-state-machine.test.ts` to `scripts/`. Add deterministic tests for `motion-planner.ts`, `alpha-beta-gamma.ts`, `cluster-trains.ts`, `track-index.ts`, `arclength.ts`.

- [ ] **CRIT-19** [Test] Add Socket.IO path coverage for dual-mode hooks | Effort: **L**
  Mock `socket.io-client` and test the store-subscription path in `use-train-positions`, `use-alerts`, `use-arrivals`. Test room subscription, message dispatch, error reconnect, and fallback from Socket.IO to polling.

- [x] **CRIT-20** [Test] Fix Redis mock `set()` signature to match ioredis v5 | Effort: **S**
  Validate the mock against the real `set(key, value, 'EX', seconds)` call signature used in `src/lib/redis.ts`.

- [x] **CRIT-21** [Test] Fix `getTextColorForBackground` function or update test to remove documented bug | Effort: **S**
  Either make the function case-insensitive or remove the test that documents the defect without fixing it.

---

## Tier 2: Important -- Should Fix Within the Next Sprint

### API & Data Pipeline

- [x] **IMP-01** [API] Replace `axios` with native `fetch` in `fetch-feed.ts` and `fetch-alerts.ts` | Effort: **M**
  Use `fetch` + `arrayBuffer()` / `json()` with `AbortController` timeout. Removes ~50 KB dependency and enables Next.js fetch instrumentation.

- [x] **IMP-02** [API] Extend `FEED_GROUPS` to include aliases; remove `routeToFeedGroup` from `trains/route.ts` | Effort: **S**
  Add `SIR`, `GS`, `FS`, `H` to `feed-groups.ts`. Delete the duplicate function from the trains route.

- [x] **IMP-03** [API] Apply `stationIdSchema`/`stopIdSchema`/`feedGroupIdSchema` validation in arrivals routes | Effort: **S**
  Wire existing validation schemas into `arrivals/station/[stationId]` and `arrivals/[groupId]/[stopId]` route handlers.

- [x] **IMP-04** [API] Fix `resolveStopNames` -- move `loadStops()` outside loop, use `Set` for deduplication | Effort: **S**
  Hoist `await loadStops()` above the `for` block. Replace `!names.includes(name)` with `Set<string>`.

- [x] **IMP-05** [API] Sanitize user input before OpenAI prompt interpolation in `conductor/announce` | Effort: **S**
  Wrap user values in a structured JSON block rather than free-form template interpolation.

- [x] **IMP-06** [API] Rename `cron/cleanup` to `cron/ttl-health-check` | Effort: **S**
  Rename route and update Vercel cron config references.

- [x] **IMP-07** [API] Return partial Redis cache results for trains; fetch only missing groups | Effort: **M**
  Filter missing groups from `tryRedisCache` results. Fetch only those groups from MTA and merge with cached data.

- [x] **IMP-08** [API] Fix serial await in `calculateDelaysBatch` | Effort: **S**
  Call `loadScheduleData()` once before the loop, then compute synchronously from already-loaded caches.

- [x] **IMP-09** [API] Add `AbortSignal` timeout and `response.ok` check to RSS fetch in `conductor/news` | Effort: **S**
  Add 5-second `AbortController`. Skip feed on non-OK response.

- [x] **IMP-10** [API] Replace in-process cache in `equipment/route.ts` with Redis | Effort: **S**
  Use `getCache`/`setCache` instead of module-level `let cache`.

### Map Components & Hooks

- [x] **IMP-11** [Map] Delete orphaned `refreshInterval` constant; add parameter to `createMotionState` | Effort: **S**
  Remove dead code at line 1084. Add `refreshInterval: number` parameter to `createMotionState` and pass from caller.

- [x] **IMP-12** [Map] Reset `isAnimatingRef.current = false` in `useMapAnimation.ts` cleanup | Effort: **S**
  One-line addition in the `useEffect` cleanup function.

- [x] **IMP-13** [Map] Pass `map` ref object (not `map.current` snapshot) to hooks in `SubwayMap.tsx` | Effort: **M**
  Update all hook signatures to accept `RefObject<Map>` and read `map.current` inside effects.

- [x] **IMP-14** [Map] Add mount guard to `useTripRouteLayer.ts` async source update | Effort: **S**
  Re-query the source inside `.then()` via `map.getSource(TRIP_ROUTE_SOURCE)` instead of using captured variable.

- [x] **IMP-15** [Map] Fix stale `selectedStationId` closure in `useStationMarkers.ts` `handleClick` | Effort: **S**
  Use `useUIStore.getState().selectedStationId` inside the handler instead of the closed-over value.

- [x] **IMP-16** [Map] Replace naive CSV parser in `track-index.ts` for `stops.txt` | Effort: **S**
  *Cross-ref: CRIT-11*. Same fix -- replace `split(',')` with quote-aware parser. Can share a single CSV utility.

- [ ] **IMP-17** [Map] Separate animation state (RAF-only) from API data (effect-only) in `TrainMotionState` | Effort: **L**
  Split the `TrainMotionState` object into two sub-objects to prevent TOCTOU hazard from concurrent RAF/effect mutations.

### Trip Planner Algorithm

- [x] **IMP-18** [Trip] Rename `findAlternativePaths` and document random sampling limitation | Effort: **S**
  Rename to `findRouteVariants`. Remove misleading "Yen's algorithm" comment. Document non-deterministic behavior.

- [ ] **IMP-19** [Trip/Server] Replace Neo4j `shortestPath` with weighted shortest-path procedure | Effort: **L**
  Use `apoc.algo.dijkstra` (if APOC available) or `allShortestPaths` as interim. Affects both `neo4j-planner.ts` and `server/src/lib/queries/trip-planner.ts`. *Cross-ref: IMP-44*

- [x] **IMP-20** [Trip] Fix `transferType` heuristic in Neo4j path converter | Effort: **S**
  Use `relProps.duration` instead of `relProps.walkTime`. Or store `transferType` as a property on the Neo4j relationship during seeding.

- [x] **IMP-21** [Trip] Add bidirectional duplicate check for transfer edges in graph builder | Effort: **S**
  Extend `alreadyHasEdge` check to inspect both forward and reverse directions.

- [x] **IMP-22** [Trip] Migrate `use-trip-planner.ts` from direct `fetch` to TanStack Query | Effort: **M**
  Add `mtaApi.planTrip(params)` to the API client. Use `useMutation` for trip planning.

- [x] **IMP-23** [Trip] Add `isPanelOpen: false` to `trip-store.ts` `reset()` action | Effort: **S**
  One-line addition to the reset state object.

- [x] **IMP-24** [Trip] Add tests using `createDoubleTransferPath` fixture | Effort: **S**
  Import the existing fixture in `path-converter.test.ts` and add test cases for consecutive transfer edges.

### Frontend UI & State

- [x] **IMP-25** [UI] Narrow selectors in `useOperationalStats` to prevent cascading re-renders | Effort: **M**
  Extract only needed fields from `useAnalytics` and memoize comparison at the hook boundary.

- [x] **IMP-26** [UI] Create `AlertsDataContext` to share a single `useAlerts()` call across consumers | Effort: **M**
  Single React context populated by one `useAlerts()` call, consumed by `AlertStatusCard`, `AlertBanner`, `AlertBadge`, `AppSidebar`, and the analytics page.

- [x] **IMP-27** [UI] Document non-persistence of `Set<string>` in alerts store, or change to array | Effort: **S**
  Either add JSDoc warning or convert `dismissedIds` to `string[]` with `Set` conversion in selector.

- [x] **IMP-28** [UI] Consolidate `useCanPlanTrip` and `useSelectedTrip` into single-selector patterns | Effort: **S**
  Use `useShallow` from `zustand/react/shallow` for combined selectors.

- [x] **IMP-29** [UI] Remove `watchId` from geolocation Zustand state; use module-level variable | Effort: **S**
  Move `watchId` to a `let _watchId: number | null = null;` outside the store.

- [x] **IMP-30** [UI] Move raw `fetch` calls in `use-transit-analysis`, `use-anomaly-feed`, `use-trip-planner` to `mtaApi` | Effort: **M**
  Add `getTransitAnalysis`, `getAnomalyFeed`, and `planTrip` to `src/lib/api/index.ts`.

- [x] **IMP-31** [UI] Remove or guard background trains sync in `useBackgroundSync` | Effort: **S**
  Check if trains query is already actively polling before registering background interval. Or remove trains from background sync entirely.

- [x] **IMP-32** [UI] Memoize date range computation in 6 analytics chart components | Effort: **S**
  Wrap `from`/`to` computation in `useMemo` with `[range]` dependency.

- [x] **IMP-33** [UI] Fix AlertBanner ticker to resume from current position on un-pause | Effort: **S**
  Track current `x` position and restart from there, or use Framer Motion `controls.pause()` / `controls.resume()`.

- [x] **IMP-34** [UI] Replace `StationSearch` dropdown with shadcn `Command`/`Combobox` | Effort: **M**
  Provides proper ARIA combobox semantics, keyboard navigation, and screen reader support out of the box.

- [x] **IMP-35** [UI] Add error reporting to `ErrorBoundary.componentDidCatch` | Effort: **S**
  Integrate `@vercel/speed-insights` error capture or Sentry's `captureException`.

- [x] **IMP-36** [UI] Remove or null-type `timeline` from `use-analytics.ts` | Effort: **S**
  Remove fabricated timeline data from the analytics hook. Type as `null` if the field must remain for future use.

- [x] **IMP-37** [UI] Add `multiArrivals` to centralized `queryKeys` registry | Effort: **S**
  Add `multiArrivals: (stationId: string) => ['arrivals', 'multi', stationId] as const` to `query-keys.ts`.

- [x] **IMP-38** [UI] Remove array index from `AnomalyFeed` event list key | Effort: **S**
  Change to `key={`${event.pk}-${event.timestamp}`}`.

### WebSocket Server

- [x] **IMP-39** [Server] Add Socket.IO connection middleware with token validation | Effort: **M**
  Add middleware to each namespace that validates a shared secret or JWT from `socket.handshake.auth`.

- [x] **IMP-40** [Server] Add input length bounds on Socket.IO subscription payloads | Effort: **S**
  Cap `routeId.length > 10`, `stationId.length > 20` in all three namespace handlers.

- [x] **IMP-41** [Server] Add MTA API key header to alert loop | Effort: **S**
  Read `MTA_API_KEY` from env and attach as `x-api-key` header. One-line fix.

- [x] **IMP-42** [Server] Add `unhandledRejection` and `uncaughtException` handlers in `index.ts` | Effort: **S**
  Log fatal error with pino and exit. Prevents silent crashes.

- [x] **IMP-43** [Server] Add `ETIMEDOUT` to timeout classification in `feed-loop.ts` | Effort: **S**
  Check both `ECONNABORTED` and `ETIMEDOUT` in the `isTimeout` condition.

- [x] **IMP-44** [Server] Change `seed-neo4j.ts` from `CREATE` to `MERGE ... SET` for idempotent re-runs | Effort: **M**
  Update all node and edge creation Cypher statements to use `MERGE`.

- [x] **IMP-45** [Server] Rewrite `toMin` function with clear `seconds / 60` formula | Effort: **S**
  Replace `Math.round(seconds / 6) / 10` with `Math.round((seconds / 60) * 10) / 10`. Add unit comment.

- [x] **IMP-46** [Server] Switch alert loop from `setInterval` to self-scheduling `setTimeout` | Effort: **S**
  Apply the same pattern as `feed-loop.ts` to prevent overlapping fetch cycles.

### Test Infrastructure

- [x] **IMP-47** [Test] Delete or replace misnamed integration tests with genuine integration tests | Effort: **M**
  Remove `src/__tests__/integration/train-tracking.test.ts` and `station-arrivals.test.ts`. Replace with a test that renders a component tree against a mocked API.

- [x] **IMP-48** [Test] Add coverage thresholds and exclude diagnostic tests in vitest config | Effort: **S**
  Add `coverage.thresholds` (lines: 70, functions: 70, branches: 60). Exclude `real-data.test.ts` from test runs.

- [x] **IMP-49** [Test] Fix `QueryWrapper` to use `useState` for stable `QueryClient` | Effort: **S**
  Change `createTestQueryClient()` to `const [queryClient] = useState(() => createTestQueryClient())`.

- [ ] **IMP-50** [Test] Write smoke tests for analytics components | Effort: **L**
  At minimum: `DelayDistributionChart`, `RoutePerformanceTable`, `LiveSystemDashboard` verifying loading/empty/error states.

- [x] **IMP-51** [Test] Add `geolocation-store.test.ts` | Effort: **S**
  Follow the pattern of other store test files. Test `watchLocation`, `stopWatching`, position updates.

- [x] **IMP-52** [Test] Add `/api/v1/trains` route test | Effort: **M**
  Model after existing `feed/[groupId]/route.test.ts`. Test aggregation across feed groups, partial cache, error handling.

- [x] **IMP-53** [Test] Fix Prisma mock to auto-reset defaults and track schema models | Effort: **M**
  After `mockReset()`, restore `findMany` to return `[]` by default. Add CI check that mock covers all schema models.

- [x] **IMP-54** [Test] Add smoke test for `src/middleware.ts` rate-limiting integration | Effort: **S**
  Verify middleware config and that rate limiting can be enabled via the existing infrastructure.

- [x] **IMP-55** [Test] Separate regression tests from CSV-dump tests in `train-state-machine.test.ts` | Effort: **S**
  Keep the two genuine regression test cases. Move diagnostic CSV output to a script.

- [ ] **IMP-56** [Test] Create server test infrastructure and add `feed-loop.ts` tests | Effort: **XL**
  Create `server/src/__tests__/` directory with ioredis mock and protobuf fixture. Test `calculateTrainPositions` and removed-trip detection. Wire server tests into CI.

---

## Tier 3: Minor -- Address Opportunistically

### API & Data Pipeline

- [x] **MIN-09** [API] Fix operator precedence in `fetch-feed.ts` stopName expression | Effort: **S**
- [x] **MIN-10** [API] Validate and sanitize trip cache key inputs | Effort: **S**
- [x] **MIN-11** [API] Consider removing service name from unauthenticated health endpoint | Effort: **S**
- [x] **MIN-12** [API] Standardize OpenAI model ID across conductor routes | Effort: **S**
- [x] **MIN-13** [API] Add service day invalidation to `scheduleDataCache` | Effort: **S**
- [x] **MIN-14** [API] Use `URLSearchParams` in `mtaApi.getAlerts` URL construction | Effort: **S**
- [x] **MIN-15** [API] Consolidate two `checkRateLimit` modules into one canonical module | Effort: **M**

### Map Components & Hooks

- [x] **MIN-01** [Map] Extract shared `buildPopupHTML` utility from duplicate popup functions | Effort: **S**
- [x] **MIN-02** [Map] Consolidate duplicate `haversineDistance` implementations | Effort: **S**
- [x] **MIN-22** [Map] Group module-level mutable globals into single typed `TrackUtils` interface | Effort: **S**
- [x] **MIN-23** [Map] Add latitude-dependence note to `getGridKey` comment | Effort: **S**
- [x] **MIN-24** [Map] Add `hasFlewToRef` guard to `MyLocationButton.tsx` flyTo effect | Effort: **S**
- [x] **MIN-25** [Map] Move pulse animation keyframe from injected `<style>` to `globals.css` | Effort: **S**
- [x] **MIN-26** [Map] Add `@returns [lat, lon]` coordinate-order JSDoc to `arclengthToLatLon` | Effort: **S**
- [x] **MIN-27** [Map] Document intentional `setMapLoaded(true)` before GeoJSON fetch | Effort: **S**

### Trip Planner Algorithm

- [x] **MIN-30** [Trip] Replace deprecated `substr` with `substring` in `generateTripId` | Effort: **S**
- [x] **MIN-31** [Trip] Replace O(E) edge-count log with running counter | Effort: **S**
- [x] **MIN-32** [Trip] Add TODO comment to unpopulated `TripSegment.direction` field | Effort: **S**

### Frontend UI & State

- [x] **MIN-07** [UI] Remove redundant `?? []` in `AlertList` | Effort: **S**
- [x] **MIN-08** [UI] Clarify overlapping `!data` branches in `TransitAnalysisCard` | Effort: **S**
- [x] **MIN-16** [UI] Replace `<span role="button">` with `<button>` in `StationCard` | Effort: **S**
- [x] **MIN-17** [UI] Add `aria-hidden="true"` to escalator SVG in `EquipmentStatusCard` | Effort: **S**
- [x] **MIN-18** [UI] Extract `GradeCell` sub-component from IIFE in `RoutePerformanceTable` | Effort: **S**
- [x] **MIN-19** [UI] Add `(estimated)` label to `DelayDistributionChart` approximation | Effort: **S**
- [x] **MIN-20** [UI] Wire theme store to DOM class -- add theme-applier component | Effort: **M**
- [x] **MIN-21** [UI] Vendor PDF.js worker instead of fetching from unpkg CDN | Effort: **S**
- [x] **MIN-46** [UI] Add `'use client'` directive to `use-mobile.ts` | Effort: **S**
- [x] **MIN-47** [UI] Move `formatTimeRange` outside `AlertCard` component body | Effort: **S**
- [x] **MIN-48** [UI] Extract shared `CHART_TOOLTIP_STYLE` constant for Recharts tooltips | Effort: **S**

### WebSocket Server

- [x] **MIN-33** [Server] Consolidate `CACHE_KEYS` from `cache.ts` and `cache-keys.ts` into one registry | Effort: **S**
- [x] **MIN-34** [Server] Restrict `pino-pretty` transport to `NODE_ENV === 'development'` only | Effort: **S**
- [x] **MIN-35** [Server] Add production-deps stage to Dockerfile to exclude devDependencies | Effort: **S**
- [x] **MIN-36** [Server] Use streaming parse for `stop_times.txt` nightly rebuild to reduce peak memory | Effort: **M**
- [x] **MIN-37** [Server] Fix `humanEta` to show `'just left'` instead of `'0m ago'` | Effort: **S**

### Test Infrastructure

- [x] **MIN-38** [Test] Add global `afterEach` with `vi.clearAllMocks()` in `src/test/setup.ts` | Effort: **S**
- [x] **MIN-39** [Test] Auto-reset factory ID counter between tests | Effort: **S**
- [x] **MIN-40** [Test] Remove `waitForElement` alias re-export from test helpers | Effort: **S**
- [x] **MIN-41** [Test] Remove duplicate test in `use-arrivals.test.ts` | Effort: **S**
- [x] **MIN-42** [Test] Replace `vi.waitFor` with `@testing-library/react` `waitFor` in alert tests | Effort: **S**
- [x] **MIN-43** [Test] Add test for `next.config.ts` cache header values | Effort: **S**
- [x] **MIN-44** [Test] Add server tests to CI pipeline | Effort: **S**
- [x] **MIN-45** [Test] Specify explicit coverage provider in `test:coverage` script | Effort: **S**

---

## Tier 4: Strategic -- Longer-Term Architectural Improvements

### API & Data Pipeline

- [ ] **STRAT-01** [API] Move `conductor/announce` audio to object store (S3/Vercel Blob) and return signed URLs | Effort: **XL**
  Replace 100-200 KB base64 data URI responses with URL indirection. Reduces API response size and serverless memory pressure.

- [x] **STRAT-02** [API] Unify caching strategy: Redis for cross-instance, in-process only for immutable data | Effort: **L**
  Audit all module-level caches. Migrate `equipment`, `poi/nearby`, and any other mutable in-process caches to Redis.

### Map Components & Hooks

- [ ] **STRAT-03** [Map] Resolve disabled state machine: fix BOARDING bug or remove state machine entirely | Effort: **XL**
  The intentionally disabled `TrainAnimationState` in `useTrainMarkers.ts` creates two partially-maintained animation paths. Decide: fix and re-enable, or remove and accept simpler lerp system.

- [x] **STRAT-04** [Map] Unify dual ref map into single marker map with `type: 'motion' | 'legacy'` discriminant | Effort: **L**
  Replace `trainAnimsRef` and `trainMotionRef` with a single `Map<string, UnifiedMarkerState>` containing a type discriminant. Simplifies cleanup, display updates, and reasoning about state.

### Trip Planner Algorithm

- [ ] **STRAT-05** [Trip] Implement true k-shortest-paths (Yen's algorithm) or document limitation permanently | Effort: **XL**
  Replace random route-exclusion with spur-node enumeration for deterministic, genuinely distinct k-shortest paths.

- [x] **STRAT-06** [Trip] Add directional travel times to graph model | Effort: **L**
  The graph is currently undirected with symmetric costs. NYC subway travel times can differ by direction. Add direction-specific edge weights from GTFS schedule data.

### Frontend UI & State

- [ ] **STRAT-07** [UI] Migrate analytics data layer from Apollo to React Query for unified caching | Effort: **XL**
  Eliminate the dual-client architecture by moving AppSync/GraphQL queries to React Query with a custom `graphqlFetcher`. Provides unified cache, devtools, and loading states.

- [ ] **STRAT-08** [UI] Add comprehensive accessibility audit and WCAG 2.1 AA compliance pass | Effort: **XL**
  Beyond `StationSearch` combobox (IMP-34), audit all interactive elements for keyboard navigation, ARIA attributes, color contrast, and screen reader support.

### WebSocket Server

- [x] **STRAT-09** [Server] Document single-instance constraint and add scale-out safeguards | Effort: **M**
  Add README documentation and Docker Compose `deploy.replicas: 1` constraint. Consider externalizing `previousTripIds` and `subscriberCount` to Redis if scale-out becomes necessary.

- [x] **STRAT-10** [Server] Merge per-feed-group arrival broadcasts into single-cycle batched broadcast | Effort: **L**
  Accumulate all 8 feed groups' entities within one cycle and call `broadcastArrivalsBatch` once. Reduces Socket.IO events from up to 8 per station to 1, producing correct merged views.

### Test Infrastructure

- [ ] **STRAT-11** [Test] Build genuine integration test suite with component tree rendering against mocked APIs | Effort: **XL**
  Render `SubwayMap` with full store + mocked feed response. Render `TripPlannerPanel` with origin/destination input. Render `/api/v1/trains` handler with mocked `fetchFeed`.

- [x] **STRAT-12** [Test] Add ESLint plugins `eslint-plugin-testing-library` and `eslint-plugin-vitest` | Effort: **S**
  Catches common mistakes: `getBy` inside `waitFor`, `vi.waitFor` vs RTL `waitFor`, `expect` outside `it` blocks.

---

## Cross-Reference Index

The following findings appear in multiple domain reviews and have been deduplicated in this task list:

| Task | Primary Domain | Also Found In |
|------|---------------|---------------|
| CRIT-11 | Trip | Map (IMP-16) |
| IMP-19 | Trip | Server (same Neo4j shortestPath issue) |
| IMP-22 | Trip | UI (IMP-30 -- raw fetch pattern) |
| IMP-30 | UI | Trip (IMP-22 -- `use-trip-planner.ts` raw fetch) |
| MIN-28 | Map | UI (`useTrainPositionsSuspense` unused) |
