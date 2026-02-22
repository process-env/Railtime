# Code Review — Context

_Created: 2026-02-22_

## Summary

Full codebase review post-analytics-supercharge across:
- **Next.js app** (`src/`): 18 issues
- **WS server** (`server/src/`): 24 issues
- **CDK infrastructure** (`infra/cdk/`): 12 issues
- **Total**: 54 issues found

## Priority Remediation (16 items)

### Phase 1: Leaf Components (Low Blast-Radius)
| ID | File | Issue | Status |
|----|------|-------|--------|
| 1A | DelayDistributionChart, TrainHistoryChart | Dynamic Tailwind `h-[${height}px]` won't compile | Fixing |
| 1B | ArrivalsTimelineChart | Dynamic `require('recharts')` inconsistent | Fixing |
| 1C | Lambda stream-to-s3, glue-trigger | `process.env.X!` non-null assertion, no validation | Fixing |
| 1D | Lambda stream-to-s3 | No try-catch, S3 upload failure = silent data loss | Fixing |
| 1E | package.json | `build:data` only runs 1 of 4 scripts | Fixing |

### Phase 2: Hooks & API (Medium Blast-Radius)
| ID | File | Issue | Status |
|----|------|-------|--------|
| 2A | trip/route.ts | `parseInt` NaN propagates through trip planner | Fixing |
| 2B | use-trip-planner.ts | `.catch(() => ({}))` swallows errors silently | N/A (reviewed — error handling is already correct in current code) |
| 2C | RoutePerformanceTable | Inline `.filter()` runs on every render | Fixing |
| 2D | graphql/client.ts | Apollo noop link returns empty data with zero logging | Fixing |
| 2E | dynamodb-writer.ts | Max retries → warn + drop, no escalation | Fixing |

### Phase 3: Core Pipeline (High Blast-Radius)
| ID | File | Issue | Status |
|----|------|-------|--------|
| 3A | feed-loop.ts | `schema.decode()` error indistinguishable from network error | Fixing |
| 3B | metrics-collector.ts | Race condition: flush timer vs collectMetrics/collectRemovedTrips | Fixing |
| 3C | dynamodb.ts + index.ts | DynamoDB client connections never closed on shutdown | Fixing |
| 3D | analytics-stack.ts | Glue role has unnecessary DynamoDB read grants | Fixing |
| 3E | Analytics page + SubwayMap + Trip planner | No error boundaries — one crash kills everything | Fixing |
| 3F | trip-planner.ts (Neo4j) | 30-hop limit too low for Far Rockaway → Bronx | Fixing |

## Out of Scope (38 Deferred)

Lower-priority items noted during review but not fixed:
- WS event type generation (cross-service contract sync)
- CSV parser replacement (works for MTA data)
- DynamoDB GSI for events table (needs CDK deploy + migration)
- Number formatting unification (cosmetic)
- Redis lazy connect (works in practice)
- GTFS data freshness validation (operational)
- Various minor code style inconsistencies
