# Analytics Overhaul — Task Checklist

## Phase 0: Dev Documentation
- [x] Create analytics-overhaul-plan.md
- [x] Create analytics-overhaul-context.md
- [x] Create analytics-overhaul-tasks.md
- [x] Update handoff-notes.md

## Phase 1: Backend — Anomaly Feed
- [x] 1.1 Modify metrics-collector.ts: ZADD anomaly events to Redis
- [x] 1.2 Add ANOMALY_FEED to cache-keys.ts
- [x] 1.3 Create anomaly-feed.ts HTTP handler
- [x] 1.4 Wire route in server/index.ts
- [x] 1.5 Server TypeScript compiles

## Phase 2: Frontend — New Components
- [x] 2.1 Create useOperationalStats hook
- [x] 2.2 Create OperationalStatsBar component
- [x] 2.3 Create BunchingGapTrendChart component
- [x] 2.4 Create useAnomalyFeed hook
- [x] 2.5 Create AnomalyFeed component
- [x] 2.6 Add anomalyFeed query key

## Phase 3: Page Assembly
- [x] 3.1 Rewrite analytics/page.tsx — single-page layout
- [x] 3.2 Update barrel exports (index.ts)
- [x] 3.3 ErrorBoundary wrapping for each section

## Phase 4: Cleanup
- [x] 4.1 Delete 15 component files (14 planned + ArrivalsTimelineChart)
- [x] 4.2 Delete 3 hook files (2 planned + use-ridership.ts)
- [x] 4.3 Delete lib files (ridership-lookup, impact-calculator)
- [x] 4.4 Remove test files (impact-calculator, ridership route)
- [x] 4.5 Delete orphaned ridership API route + type
- [x] 4.6 Clean up getRidership from lib/api/index.ts

## Phase 5: Quality Gate
- [x] 5.1 TypeScript compiles (app + server — zero errors)
- [x] 5.2 Tests pass (44 files, 683 tests)
- [x] 5.3 Lint clean (zero errors, 1 warning fixed)
- [x] 5.4 Build succeeds (Next.js 16, 22 pages)
