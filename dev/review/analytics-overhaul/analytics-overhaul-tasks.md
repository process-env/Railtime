Last Updated: 2026-02-23

# Analytics Overhaul — Remediation Tasks

Derived from [analytics-overhaul-review.md](./analytics-overhaul-review.md). Items are grouped
by severity and ordered by urgency. Each item references the finding ID in the review document.

---

## Critical (fix soon)

- [ ] **[C1] Cap `bunchingStops`/`gapStops` arrays at 100 entries in `metrics-collector.ts`** — **S** effort
- [ ] **[P1/D2] Parallelize DynamoDB batch writes with `Promise.all()` in `dynamodb-writer.ts`** — **S** effort
- [ ] **[D3] Add dead-letter logging for failed DynamoDB batches after MAX_RETRIES** — **M** effort

---

## High (next sprint)

- [ ] **[M1] Extract Recharts colors to theme-aware constants**
  - Affects `DelayTrendChart.tsx`, `BunchingGapTrendChart.tsx`
  - **M** effort

- [ ] **[C2] Replace array index with stable key (event ID or timestamp) in `AnomalyFeed.tsx`** — **S** effort

- [ ] **[C3/P2] Wrap `today` date calculation in `useOperationalStats.ts` with proper memoization** — **S** effort

---

## Medium (backlog)

- [ ] **[M2] Extract anomaly thresholds (bunching > 15, gaps > 10) to `src/lib/constants.ts`** — **S** effort
- [ ] **[A2] Add `aria-label` to stat cards and select dropdowns** — **S** effort
- [ ] **[A1] Add heading hierarchy (`h2`/`h3`) to analytics page sections** — **S** effort
- [ ] **[D4] Import `EventRecord` type in `anomaly-feed.ts` instead of duck-typing** — **S** effort
- [ ] **[D1] Add cursor-based pagination to anomaly-feed endpoint** — **M** effort
- [ ] **[M3] Validate CSV column count in stop-name loader** — **S** effort
- [ ] **[S2] Add null check before `alert.headerText.slice()` in metrics-collector** — **S** effort

---

## Low (nice-to-have)

- [ ] Extract time formatting utilities to `src/lib/utils` — **S** effort
- [ ] **[P3] Cache `parseEvent()` result in AnomalyFeed to avoid double-call** — **S** effort
- [ ] **[A3] Add data table fallback for charts (accessibility)** — **L** effort
- [ ] **[M4] Document redundant `stationId`/`stopId` and plan deprecation** — **S** effort

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | < 1 hour, single file |
| **M** | 1-4 hours, 2-3 files |
| **L** | 4+ hours, cross-cutting |
