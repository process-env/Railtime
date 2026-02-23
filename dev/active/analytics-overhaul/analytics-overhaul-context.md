# Analytics Overhaul — Context

## Data Sources
| Source | Hook | Backend |
|--------|------|---------|
| Live train positions | `useAnalytics()` | MTA GTFS-RT feeds |
| Daily rollups | `useDailyRollups()` | AppSync → DynamoDB `railtime-rollups` |
| Anomaly events | `useAnomalyFeed()` | WS server → Redis sorted set |
| AI analysis | `useTransitAnalysis()` | WS server → Redis (Bedrock Nova Micro) |
| Service alerts | `useAlerts()` | Zustand store (real-time) |
| System health | `useSystemHealth()` | AppSync → DynamoDB `railtime-metrics` |

## New Files Created
- `server/src/api/anomaly-feed.ts` — HTTP endpoint
- `server/src/lib/cache-keys.ts` — added ANOMALY_FEED key
- `src/hooks/use-operational-stats.ts` — composing hook
- `src/hooks/use-anomaly-feed.ts` — React Query hook
- `src/components/analytics/OperationalStatsBar.tsx`
- `src/components/analytics/BunchingGapTrendChart.tsx`
- `src/components/analytics/AnomalyFeed.tsx`

## Modified Files
- `server/src/analytics/metrics-collector.ts` — ZADD to Redis on flush
- `server/src/index.ts` — new /api/anomaly-feed route
- `src/lib/api/query-keys.ts` — anomalyFeed key
- `src/app/(dashboard)/analytics/page.tsx` — full rewrite
- `src/components/analytics/index.ts` — updated barrel

## Deleted Components (Phase 4)
EconomicImpactCard, EnvironmentalImpactCard, RidershipAnimationCard, RidershipTrendChart, RidershipStatsCard, ScheduleFrequencyCard, BusiestStationsCard, RouteProfileCard, ServiceSpanCard, RouteActivityChart, TrainHistoryChart, StatsCard, FeedStatusCard, HistoricalDataCard

## Deleted Hooks
use-impact-metrics.ts, use-schedule-analytics.ts

## Preserved (alerts page dependency)
EquipmentStatusCard — imported by src/app/(dashboard)/alerts/page.tsx
