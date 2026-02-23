# Analytics Page Overhaul — Operational Intelligence Dashboard

## Goal
Replace the 5-tab analytics page with a single-page operational intelligence dashboard focused on real data from the ML Lab pipeline.

## New Layout
Single scrollable page:
1. OperationalStatsBar — 4 metric cards (active trains, on-time %, bunching, gaps)
2. TransitAnalysisCard — AI insights from Bedrock
3. AnomalyFeed + BestWorstRouteCard + AlertStatusCard — live events + route health
4. RoutePerformanceTable — full-width performance grid
5. BunchingGapTrendChart + SystemHealthTimeline — trends
6. DelayTrendChart + DelayDistributionChart — delay analysis
7. TripCompletionChart + LiveSystemDashboard — bottom row

## Phases
- Phase 0: Dev documentation (this)
- Phase 1: Backend — anomaly feed endpoint on WS server (Redis sorted set)
- Phase 2: Frontend — new components + hooks (5 new files)
- Phase 3: Page assembly — rewrite analytics/page.tsx
- Phase 4: Cleanup — delete 14 unused components, 2 hooks, lib files
- Phase 5: Quality gate — TypeScript, tests, lint

## Key Decisions
- Single page over tabs: reduces complexity, shows all operational data at a glance
- Anomaly feed via Redis sorted set: sub-second latency, auto-trimmed to 1 hour
- Keep existing components where possible (8 kept, 14 deleted)
- EquipmentStatusCard preserved — used on alerts page
