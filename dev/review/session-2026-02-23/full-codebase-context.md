Last Updated: 2026-02-23

# Full Codebase Review -- Context

## What Was Reviewed

- **Frontend**: ~100+ files under `src/` (App Router routes, components, hooks, stores, lib utilities, types, tests)
- **Server**: 21 files under `server/src/` (ingestion loops, namespace handlers, analytics collector, lib helpers, scripts, API endpoint)
- **Infrastructure**: 4 CDK files under `infra/cdk/lib/`, 2 Lambda handlers under `infra/cdk/lambda/`, 2 Docker Compose files (`docker-compose.v2.yml`, `infra/docker-compose.prod.yml`), nginx config (`infra/nginx.conf`), EC2 setup script (`infra/ec2-setup.sh`), CI pipeline (`.github/workflows/ci.yml`), server Dockerfile (`server/Dockerfile`)
- **Branch**: main
- **Commit**: 59201db

## Architecture Overview

Railtime is a two-package monorepo:

1. **Next.js app** (root): React 19, Next.js 16 (App Router), deployed on Vercel. Handles the web frontend, API routes (conductor AI, trip planning, train aggregation), and static data serving. Uses MapLibre GL for map rendering with imperative marker management, Zustand for client state, and React Query for server-state/polling.

2. **WebSocket server** (`server/`): Standalone Node.js process with Socket.IO, deployed on EC2 via Docker Compose alongside Neo4j and Redis. Handles real-time train position broadcasting, service alert push, and per-station arrival boards. Uses pino for structured logging and ioredis for Redis connectivity.

### Data Flow

```
MTA GTFS-RT (protobuf) --> server/feed-loop.ts --> Redis cache --> Socket.IO broadcast --> Browser
                                                                                            |
                                                                                    Zustand stores --> MapLibre markers
```

The system supports graceful degradation via feature flags:
- `NEXT_PUBLIC_WS_URL`: When set, Socket.IO push is used; otherwise, falls back to React Query polling (15s interval)
- `NEO4J_URI`: When set, Neo4j Dijkstra is used for trip planning; otherwise, falls back to in-memory JS Dijkstra
- `REDIS_URL`: When set, Redis caching is used; otherwise, direct fetch

### AWS Analytics Pipeline (CDK)

```
WS Server --> DynamoDB (metrics, events) --> DynamoDB Streams --> Lambda (stream-to-s3) --> S3 (raw NDJSON)
                                                                                              |
                                                                           Glue Crawler --> Glue ETL Job --> DynamoDB (rollups)
                                                                                                              |
                                                                                              AppSync GraphQL API --> Frontend
```

### Deployment Targets

| Component | Target | URL |
|-----------|--------|-----|
| Next.js app | Vercel | traintracker-kappa.vercel.app |
| WS server + Neo4j + Redis + nginx | EC2 t3.small | (private IP) |
| Analytics pipeline | AWS (CDK-managed) | AppSync endpoint |

## Domain Review Files

- **Frontend**: `dev/active/frontend-deep-review/frontend-deep-review-code-review.md`
- **Server**: `dev/active/server-deep-review/server-deep-review-code-review.md`
- **Infrastructure**: `dev/active/infra-code-review/infra-code-review.md`

## Known Constraints

- Solo-dev project -- some operational gaps are acceptable
- t3.small EC2 (2 vCPU, 2GB RAM) -- resource-constrained backend
- No staging environment -- changes go directly to production
- MTA GTFS-RT feeds are external dependency with variable latency (0.5s to 15s response times)
- MTA API key enforcement is inconsistent -- endpoints may begin requiring it without notice
- Single EC2 instance with no replication -- EBS failure = total outage
- Vercel auto-deploy is not reliably connected to GitHub -- manual `vercel --prod` required after push
- AppSync API key expires after 365 days from first deployment with no rotation mechanism

## Review Methodology

Each domain review followed a consistent process:

1. **Inventory**: List all files in the domain, categorize by function (data layer, presentation, config, tests)
2. **Dependency mapping**: Trace imports, data flow, and shared state across module boundaries
3. **Critical path analysis**: Identify highest blast-radius files and most expensive operations
4. **Issue classification**: Severity (Critical/Important/Minor) based on security, reliability, and correctness impact
5. **Fix recommendations**: Concrete code changes with before/after examples

## Review Timeline

| Domain | Files | Issues Found | Review Date |
|--------|-------|-------------|-------------|
| Frontend | ~100+ | 22 | 2026-02-23 |
| Server | 21 | 21 | 2026-02-23 |
| Infrastructure | ~15 | 24 | 2026-02-23 |
| **Total** | **~140** | **67** | |
