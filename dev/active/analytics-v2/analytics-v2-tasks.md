> **Status: COMPLETE** — All 43 tasks completed as of 2026-02-22.

# Analytics v2 — Task Checklist

Last Updated: 2026-02-22

## Phase 1: Schedule Lookup
- [x] **1.1** Create `server/src/analytics/schedule-lookup.ts` — load stop_times.txt + trips.txt into hash map `{tripId:stopId → scheduledArrivalSeconds}` filtered by today's service_id | Effort: L | Priority: Critical
- [x] **1.2** Add midnight UTC reset logic — rebuild schedule map when service day changes | Effort: S | Priority: High
- [x] **1.3** Handle GTFS time > 24:00:00 (after-midnight service wraps to next day) | Effort: S | Priority: High
- [x] **1.4** Call `loadSchedule()` from `server/src/index.ts` at startup, pass to collector | Effort: S | Priority: Critical
- [x] **1.5** Add `DATA_DIR` env var support for locating stop_times.txt/trips.txt | Effort: S | Priority: Medium

## Phase 2: Direction-Aware Metrics
- [x] **2.1** Add direction extraction utility: `getDirection(stopId) → 'N' | 'S' | null` | Effort: S | Priority: Critical
- [x] **2.2** Refactor `metrics-collector.ts` buffer key from `routeId` to `routeId#direction` | Effort: M | Priority: Critical
- [x] **2.3** Add `direction` field to `MetricRecord` in `dynamodb-writer.ts` | Effort: S | Priority: Critical
- [x] **2.4** Change `RollupRecord` SK from `date` to `date#direction` in `dynamodb-writer.ts` | Effort: S | Priority: Critical
- [x] **2.5** Update daily accumulator key to include direction | Effort: S | Priority: Critical

## Phase 3: Real Delay Computation
- [x] **3.1** Replace `su.arrival.delay` read with schedule deviation computation: `actualArrival - scheduledArrival` | Effort: M | Priority: Critical | Depends: 1.1
- [x] **3.2** Handle edge cases: null arrival.time, trip not in schedule, unscheduled trips | Effort: M | Priority: High
- [x] **3.3** Add log for delay distribution on first flush (validate data is real) | Effort: S | Priority: Medium

## Phase 4: Per-Stop Headway
- [x] **4.1** Keep per-stop headway grouping (already fixed) — validate direction is included via stopId suffix | Effort: S | Priority: Medium | Depends: 2.1
- [x] **4.2** Add median headway computation (more robust than mean for outliers) | Effort: S | Priority: High
- [x] **4.3** Add bunching detection: headway < 120s at any stop → increment counter | Effort: S | Priority: Medium
- [x] **4.4** Add gap detection: headway > 900s (local) / 1200s (express) → increment counter | Effort: M | Priority: Medium

## Phase 5: Events
- [x] **5.1** Write events for ALL alerts regardless of severity (remove severity filter) — already coded, needs rebuild | Effort: S | Priority: High
- [x] **5.2** Generate `BUNCH#routeId` events when bunching detected | Effort: S | Priority: Medium | Depends: 4.3
- [x] **5.3** Generate `GAP#routeId` events when service gap detected | Effort: S | Priority: Medium | Depends: 4.4
- [x] **5.4** Generate `SKIP#routeId` events for `scheduleRelationship === 'SKIPPED'` stops | Effort: S | Priority: Medium

## Phase 6: AppSync Schema + Resolvers
- [x] **6.1** Add `direction: String` to `RouteMetric` and `DailyRollup` types in schema.graphql | Effort: S | Priority: Critical | Depends: 2.3
- [x] **6.2** Add `headwayMedianSeconds`, `bunchingCount`, `gapCount` to `RouteMetric` type | Effort: S | Priority: High
- [x] **6.3** Add `medianHeadway`, `totalBunching`, `totalGaps`, `totalSkippedStops` to `DailyRollup` type | Effort: S | Priority: High
- [x] **6.4** Add optional `direction: String` param to `getRouteMetrics` and `getDailyRollups` queries | Effort: S | Priority: High
- [x] **6.5** Update `getDailyRollups.req.vtl` to handle SK format `date#direction` + optional direction filter | Effort: M | Priority: Critical
- [x] **6.6** Update `getRouteMetrics.req.vtl` to optionally filter by direction attribute | Effort: M | Priority: High
- [x] **6.7** CDK deploy to update AppSync | Effort: S | Priority: Critical

## Phase 7: Frontend
- [x] **7.1** Add `direction` + new fields to `src/lib/graphql/types.ts` | Effort: S | Priority: Critical | Depends: 6.1
- [x] **7.2** Add optional `direction` param to queries in `src/lib/graphql/queries.ts` | Effort: S | Priority: Critical
- [x] **7.3** Add direction param to hooks in `src/hooks/use-analytics-data.ts` | Effort: S | Priority: High
- [x] **7.4** Update `DelayTrendChart.tsx` — show N/S direction lines per route | Effort: M | Priority: High
- [x] **7.5** Update `RoutePerformanceTable.tsx` — add direction column, show real delay | Effort: M | Priority: High
- [x] **7.6** Update `SystemHealthTimeline.tsx` — aggregate directions for system-wide view | Effort: S | Priority: Medium
- [x] **7.7** Handle null metrics gracefully — show "No data" not "100%" | Effort: S | Priority: High

## Phase 8: Deploy + Verify
- [x] **8.1** Server TypeScript compiles clean | Effort: S | Priority: Critical
- [x] **8.2** CDK deploy (AppSync schema + resolvers) | Effort: S | Priority: Critical
- [x] **8.3** Rebuild + restart WS server Docker container | Effort: S | Priority: Critical
- [x] **8.4** Vercel deploy (frontend) | Effort: S | Priority: Critical
- [x] **8.5** Verify: DynamoDB metrics have direction + non-zero delay values | Effort: S | Priority: Critical
- [x] **8.6** Verify: DynamoDB events table has alert records | Effort: S | Priority: High
- [x] **8.7** Verify: Frontend charts show real data, not 100%/0 | Effort: S | Priority: Critical
- [x] **8.8** Verify: Rollups table updates every 5 min with direction-aware data | Effort: S | Priority: High

## Summary

| Phase | Tasks | Critical | Effort |
|-------|-------|----------|--------|
| 1. Schedule Lookup | 5 | 2 | L |
| 2. Direction Metrics | 5 | 4 | M |
| 3. Real Delay | 3 | 1 | M |
| 4. Headway | 4 | 0 | M |
| 5. Events | 4 | 0 | S |
| 6. AppSync | 7 | 3 | M |
| 7. Frontend | 7 | 2 | M |
| 8. Deploy | 8 | 5 | S |
| **Total** | **43** | **17** | |
