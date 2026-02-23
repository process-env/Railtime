Last Updated: 2026-02-23

# Analytics Overhaul — Code Review

**Commits Reviewed**: `7bb48c7`, `4cbd33c`, `0ed1417`
**Status**: Ship-worthy with medium-priority improvements needed

---

## Executive Summary

Core architecture is solid — Redis sorted set for anomaly events, React Query polling, composable hooks. The single-page operational intelligence dashboard replaces the previous 5-tab analytics layout with a cleaner, more focused design.

Main concerns: hard-coded dark-mode colors in Recharts charts, unbounded arrays in metrics-collector, sequential DynamoDB batch writes, and some memoization inefficiencies.

---

## Strengths

- **Clean single-page layout** with granular ErrorBoundary wrapping per section
- **Excellent hook composition** — `useOperationalStats` composes 3 data sources cleanly
- **Good data transformation** — distinct routes via Sets instead of raw counts
- **Client-side filtering** for instant UX (route/time-range selectors)
- **Responsive grid layout** — mobile to desktop breakpoints
- **Station name resolution** from GTFS stops.txt for human-readable anomaly events

---

## Issues

### Correctness / Bugs

| # | File | Issue | Severity |
|---|------|-------|----------|
| C1 | `server/src/analytics/metrics-collector.ts` | Unbounded `bunchingStops`/`gapStops` arrays — memory leak under sustained load | HIGH |
| C2 | `src/components/analytics/AnomalyFeed.tsx` | Array index `i` used as React key — rendering bugs if list order changes | MEDIUM |
| C3 | `src/hooks/use-operational-stats.ts` | `today` recalculated every render defeats `useMemo` dependency check | MEDIUM |

### Design & Architecture

| # | File | Issue | Severity |
|---|------|-------|----------|
| D1 | `server/src/api/anomaly-feed.ts` | No pagination support; fetches 200 then filters client-side | MEDIUM |
| D2 | `server/src/analytics/dynamodb-writer.ts` | Sequential batch writes — 40x slower than parallel `Promise.all` | HIGH |
| D3 | `server/src/analytics/dynamodb-writer.ts` | Lost batches on MAX_RETRIES with no DLQ or alerting | HIGH |
| D4 | `server/src/api/anomaly-feed.ts` | Duck-typing `{ pk: string }` instead of importing `EventRecord` | LOW |

### Maintainability

| # | File | Issue | Severity |
|---|------|-------|----------|
| M1 | `src/components/analytics/DelayTrendChart.tsx`, `BunchingGapTrendChart.tsx` | Hard-coded dark-mode hex colors — breaks in light mode | HIGH |
| M2 | `server/src/analytics/metrics-collector.ts` | Hard-coded anomaly thresholds (bunching > 15, gaps > 10) without constants | MEDIUM |
| M3 | `server/src/analytics/metrics-collector.ts` | Naive CSV parsing for stops.txt without quoted-field handling | MEDIUM |
| M4 | Multiple | Redundant `stationId` vs `stopId` fields in `EventRecord` | LOW |

### Performance

| # | File | Issue | Severity |
|---|------|-------|----------|
| P1 | `server/src/analytics/dynamodb-writer.ts` | 40 sequential batches x 100-200ms = 4-8s flush time | HIGH |
| P2 | `src/hooks/use-operational-stats.ts` | Date recalculation defeats memoization on every render | MEDIUM |
| P3 | `src/components/analytics/AnomalyFeed.tsx` | `parseEvent()` called twice per event (filter + render) | LOW |

### Accessibility

| # | File | Issue | Severity |
|---|------|-------|----------|
| A1 | `src/app/(dashboard)/analytics/page.tsx` | No semantic heading hierarchy (h2/h3) in analytics page | MEDIUM |
| A2 | `src/components/analytics/OperationalStatsBar.tsx` | Icon-only stat cards without aria-labels | MEDIUM |
| A3 | Multiple chart components | Charts lack data table fallbacks for screen readers | LOW |
| A4 | `src/components/analytics/AnomalyFeed.tsx` | Type badges rely on color alone without text differentiation | MEDIUM |

### Security

| # | File | Issue | Severity |
|---|------|-------|----------|
| S1 | `server/src/api/anomaly-feed.ts` | No rate limiting on open endpoint | LOW (internal use) |
| S2 | `server/src/analytics/metrics-collector.ts` | `alert.headerText.slice(0, 200)` without null check | LOW |

---

## Verdict

**Ship-worthy.** No blocking issues. The critical items (unbounded arrays, sequential DynamoDB writes) should be addressed in the next sprint to prevent production incidents under sustained load.
