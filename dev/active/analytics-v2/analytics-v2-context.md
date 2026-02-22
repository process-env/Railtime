# Analytics v2 — Context

Last Updated: 2026-02-22

## Current State (2026-02-22)

All v2 analytics work is **complete and deployed**:
- All 6 known problems from the table below are resolved
- Trip lifecycle tracking added (TRIP_START/TRIP_END events via activeTripMap)
- 22 analytics components, all wired into 5-tab dashboard
- Code review identified 16 follow-up fixes (see `dev/active/code-review/code-review-context.md`)
- AppSync schema includes: RouteMetric, DailyRollup, SystemHealth, TripEvent types
- Direction-aware metrics (N/S suffix from stopId) flowing to DynamoDB

---

## What Was Reviewed

### Server-Side (WS Server)
- `server/src/analytics/metrics-collector.ts` — In-memory buffer + 5-min flush
- `server/src/analytics/dynamodb-writer.ts` — BatchWriteItem to 3 DynamoDB tables
- `server/src/ingestion/feed-loop.ts` — GTFS-RT protobuf decode, train position interpolation
- `server/src/ingestion/alert-loop.ts` — MTA alerts JSON polling
- `server/src/types.ts` — FeedEntity, StopUpdate, TrainPosition, ServiceAlert
- `server/src/lib/dynamodb.ts` — Lazy DynamoDB client singleton
- `server/src/index.ts` — Server entry, collector integration points

### Infrastructure
- `infra/cdk/lib/analytics-stack.ts` — CDK stack (3 tables, S3, Lambda, Glue, AppSync)
- `infra/cdk/appsync/schema.graphql` — GraphQL schema
- `infra/cdk/appsync/resolvers/` — VTL resolvers for DynamoDB queries

### Frontend
- `src/components/analytics/` — 18 components (real-time + historical)
- `src/lib/graphql/queries.ts` — Apollo gql documents
- `src/lib/graphql/types.ts` — TypeScript interfaces for GraphQL
- `src/hooks/use-analytics-data.ts` — Apollo hooks
- `src/app/(dashboard)/analytics/page.tsx` — Analytics page layout

### Static Data
- `public/data/stops.txt` — 472 stations, stop IDs with N/S direction suffix
- `public/data/stop_times.txt` — 562K rows, scheduled arrival/departure per trip+stop
- `public/data/trips.txt` — 20K trips with `direction_id` (0 or 1)
- `public/data/routes.txt` — 30 subway routes

## Known Problems (Why v2 Is Needed)

| Problem | Root Cause | Impact |
|---------|-----------|--------|
| `onTimePercent: 100%` always | MTA `arrival.delay` field is 0 for all stops | Fake metric, useless |
| `avgDelay: 0` always | Same — delay field unreliable | Fake metric, useless |
| No direction dimension | Metrics group by `routeId` only, not direction | Can't distinguish uptown vs downtown |
| Headway was wrong | Old code compared trains at different stations | Fixed but still lacks direction |
| Events table empty | MTA classifies ALL alerts as "Information" (severity=info) | No alert history tracked |
| All `alertType: "Information"` | MTA's `mercury_alert.alert_type` doesn't differentiate | Severity mapping is useless |

## Available Data for Meaningful Metrics

### From TrainPosition (every 15s per feed group)
| Field | Use For |
|-------|---------|
| `routeId` | Route identification |
| `headsign` | Direction (terminal name, e.g. "South Ferry") |
| `nextStopId` | Has N/S suffix = direction |
| `nextTimeMs` / `prevTimeMs` | Per-stop headway computation |
| `lat`, `lon` | Position (could compute speed) |
| `tripId` | Trip tracking across cycles |

### From FeedEntity.stopUpdates (every 15s)
| Field | Use For |
|-------|---------|
| `stopId` | Station + direction (N/S suffix) |
| `arrival.time` | Predicted arrival (absolute epoch) |
| `scheduleRelationship` | Detect SKIPPED stops |
| `arrival.delay` | UNRELIABLE — ignore |

### From GTFS Static (stop_times.txt)
| Field | Use For |
|-------|---------|
| `trip_id` + `stop_id` → `arrival_time` | Scheduled time lookup |
| Compare RT `arrival.time` vs static schedule | **REAL delay computation** |

### From trips.txt
| Field | Use For |
|-------|---------|
| `direction_id` (0 or 1) | Direction classification |
| `trip_headsign` | Terminal name |

## Architectural Constraints

- **DynamoDB tables already deployed** (CDK stack) — schema changes need migration
- **AppSync resolvers are VTL** — changes require CDK redeploy
- **stop_times.txt is 34.5MB** — loading into memory on WS server is feasible but needs attention
- **Feed-loop runs every 15s** — schedule lookup must be fast (O(1) hash map)
- **5-min flush** — aggregation window is fixed
- **Frontend uses Apollo Client** — GraphQL schema changes ripple to types + queries + components

## Key Decisions Made

1. Use `stop_times.txt` schedule lookup for real delay (not MTA's delay field)
2. Extract direction from `nextStopId` suffix (N/S) — simpler than matching headsigns
3. Track all alerts regardless of severity (MTA's severity is useless)
4. Composite key `routeId#direction` for direction-aware metrics
5. Per-stop headway with direction (stopId already encodes direction via N/S)

## Environment

- **AWS Account**: 328991713553 (us-east-1)
- **DynamoDB Tables**: railtime-metrics, railtime-events, railtime-rollups
- **AppSync URL**: https://yiezfv3fpvfx7pqhigkp4huoki.appsync-api.us-east-1.amazonaws.com/graphql
- **S3 Bucket**: railtime-analytics-328991713553
- **WS Server**: Docker container (traintracker-ws-server-1)
