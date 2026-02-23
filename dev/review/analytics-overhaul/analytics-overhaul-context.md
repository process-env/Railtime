Last Updated: 2026-02-23

# Analytics Overhaul — Review Context

**Feature**: Replace 5-tab analytics page with single-page Operational Intelligence Dashboard
**Commits**: `7bb48c7`, `4cbd33c`, `0ed1417`

---

## Scope

### Backend (5 files)

| File | Role |
|------|------|
| `server/src/analytics/metrics-collector.ts` | Computes bunching/gap/delay anomalies from live feed data |
| `server/src/api/anomaly-feed.ts` | Express endpoint serving anomaly events from Redis sorted set |
| `server/src/lib/cache-keys.ts` | Redis key patterns for anomaly storage |
| `server/src/analytics/dynamodb-writer.ts` | Batched persistence of anomaly events to DynamoDB |
| `server/src/index.ts` | Server entry — registers anomaly feed route |

### Frontend (9 files)

| File | Role |
|------|------|
| `src/app/(dashboard)/analytics/page.tsx` | Main analytics page — single-page layout with ErrorBoundary sections |
| `src/hooks/use-anomaly-feed.ts` | React Query hook polling `/api/anomaly-feed` |
| `src/hooks/use-operational-stats.ts` | Composable hook: merges anomaly + delay + alert data |
| `src/components/analytics/OperationalStatsBar.tsx` | Summary stat cards (delays, bunching, gaps, alerts) |
| `src/components/analytics/AnomalyFeed.tsx` | Scrollable anomaly event list with route/time filtering |
| `src/components/analytics/BunchingGapTrendChart.tsx` | Recharts area chart for bunching/gap trends |
| `src/components/analytics/DelayTrendChart.tsx` | Recharts bar chart for delay distribution |
| `src/components/analytics/index.ts` | Barrel export for analytics components |
| `src/lib/api/query-keys.ts` | Added `anomalyFeed` query key |

### Deleted (23 files)

15 analytics components (old 5-tab layout), 3 hooks, 3 lib/test files, 2 API routes replaced by the new consolidated design.

---

## Architecture Decisions

1. **Single page over tabs** — Reduced component count from 23 to 9, eliminated inter-tab state coordination
2. **Redis sorted set for anomaly events** — Time-range queries via ZRANGEBYSCORE, natural TTL via ZREMRANGEBYSCORE
3. **React Query polling over WebSocket** — Analytics data is not latency-sensitive; 30s polling avoids Socket.IO namespace complexity
4. **Client-side filtering** — Dataset is small enough (<=200 events) that server-side filtering adds no benefit
5. **Composable hooks** — `useOperationalStats` composes `useAnomalyFeed` + `useDelayData` + `useAlerts` rather than a monolithic fetch
