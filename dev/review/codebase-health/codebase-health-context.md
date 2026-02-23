Last Updated: 2026-02-23

# Codebase Health Review -- Context

---

## What Was Reviewed

This health review synthesizes six parallel domain-specific architectural reviews that collectively cover the complete Railtime codebase. No source file in either the Next.js app or the WebSocket server was excluded.

### Review Scope

| Domain Review | Files Covered | Reviewer Focus |
|--------------|---------------|----------------|
| API & Data Pipeline | 27 API route handlers in `src/app/api/`, full `src/lib/mta/` data layer, `src/lib/api/` utilities, `src/lib/db.ts`, `src/lib/redis.ts`, `src/lib/validation/` | Security, input validation, caching strategy, error handling, rate limiting |
| Map Components & Hooks | `SubwayMap.tsx`, 5 hooks in `src/components/map/hooks/`, 6 utility modules in `src/lib/map/`, geo utilities, `TrainDetailPanel`, `TripMarkers`, `MyLocationButton` | Memory safety, race conditions, animation correctness, MapLibre patterns |
| Trip Planner Algorithm | `src/lib/trip-planner/` (graph-builder, dijkstra, path-converter, types), `neo4j-planner.ts`, `use-trip-planner.ts`, `trip-store.ts`, API route | Algorithmic correctness, Neo4j/in-memory equivalence, graph model, test coverage |
| Frontend UI & State | 5 Zustand stores, 20+ custom hooks, 14 analytics components, all layout/alert/station/trip-planner components, 4 providers, all dashboard pages, `ErrorBoundary` | Data architecture, render performance, accessibility, state management patterns |
| WebSocket Server | All 25 source files in `server/src/` (index, 3 ingestion loops, 3 namespace handlers, analytics pipeline, library helpers, seed script) | Production resilience, shutdown sequence, data loss risks, external service degradation |
| Test Infrastructure | 44 test files, vitest config, CI pipeline, all mocks/factories/helpers in `src/test/`, server vitest config | Coverage gaps, mock correctness, test quality, CI completeness |

### File Counts

- **Frontend source files** (`src/`): ~231 files
- **Server source files** (`server/src/`): 25 files
- **Test files**: 44 files (662 reported tests)
- **API route handlers**: 27
- **Total lines of code reviewed**: Estimated 25,000+ across both packages

---

## Project Architecture Overview

### Two-Package Structure

Railtime is a real-time NYC subway tracker built as two cooperating packages:

1. **Next.js App** (root `package.json`): React 19, Next.js 16 (App Router), TypeScript, deployed on Vercel. Handles all user-facing rendering, API routes for data aggregation, and the trip planner algorithm.

2. **WebSocket Server** (`server/package.json`): Standalone Node.js process, Socket.IO, deployed on EC2. Ingests MTA GTFS-RT protobuf feeds in real time, broadcasts train positions, service alerts, and arrival predictions to connected browsers.

### Data Flow

```
MTA GTFS-RT (protobuf)
    |
    v
server/feed-loop.ts --> Redis --> Socket.IO broadcast --> Browser
                                                            |
                                                            v
                                                    Zustand stores --> MapLibre markers

(Fallback when WS unavailable):
MTA GTFS-RT --> /api/v1/feed/[groupId] --> /api/v1/trains --> React Query (15s polling) --> Zustand --> MapLibre
```

### Graceful Degradation (Feature Flags)

| Flag | Present | Absent (Fallback) |
|------|---------|-------------------|
| `NEXT_PUBLIC_WS_URL` | Socket.IO push (real-time) | React Query polling (15s) |
| `NEO4J_URI` | Neo4j Dijkstra (graph DB) | In-memory JS Dijkstra |
| `REDIS_URL` | Redis caching | Direct fetch (no cache) |

### Key Infrastructure Dependencies

| Service | Purpose | Required |
|---------|---------|----------|
| PostgreSQL (Prisma) | Station and Route models | Yes |
| Redis 7 | Caching + Socket.IO adapter pub/sub | Optional (graceful degradation) |
| Neo4j 5 Community | Graph DB for trip planning | Optional (falls back to in-memory Dijkstra) |
| DynamoDB | Analytics metrics and delay events | Optional (analytics disabled without it) |
| S3 / Bedrock | Position archiving and AI transit analysis | Optional |
| MTA GTFS-RT API | Real-time train data | Yes (core data source) |
| TomTom API | POI search | Optional (conductor feature only) |
| OpenAI API | AI tour guide announcements | Optional (conductor feature only) |
| ElevenLabs API | Text-to-speech for announcements | Optional (conductor feature only) |

---

## Technology Stack Summary

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16 (App Router) | Framework, SSR, API routes |
| React | 19 | UI rendering |
| TypeScript | 5.x | Type safety |
| MapLibre GL | Latest | Map rendering (imperative markers) |
| Zustand | Latest | Client UI state (5 stores) |
| TanStack React Query | Latest | Server state, polling, caching |
| Apollo Client | Latest | GraphQL/AppSync analytics data |
| Tailwind CSS | 4 | Styling |
| shadcn/ui | Latest | UI component primitives (Radix + CVA) |
| Recharts | Latest | Analytics charts |
| Framer Motion | Latest | Animations (alert ticker, transitions) |
| Socket.IO Client | Latest | Real-time data (dual-mode with polling fallback) |

### Server

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20 | Runtime |
| Socket.IO | Latest | Real-time broadcasting (3 namespaces) |
| ioredis | v5 | Redis client + Socket.IO adapter |
| axios | Latest | MTA API HTTP client |
| protobufjs | Latest | GTFS-RT protobuf decoding |
| neo4j-driver | Latest | Graph DB client |
| @aws-sdk/* | Latest | DynamoDB, S3, Bedrock clients |
| pino | Latest | Structured logging |

### Build and Test

| Technology | Purpose |
|-----------|---------|
| Vitest | Unit and integration testing |
| @testing-library/react | Component testing |
| ESLint (flat config) | Linting (next core-web-vitals + TypeScript) |
| GitHub Actions | CI (lint, test, build for both packages) |
| Vercel | Frontend deployment |
| Docker Compose | Server deployment (dev and prod configs) |

---

## Review Methodology

### Approach

Six parallel domain-specific architectural reviews were conducted independently, each focusing on a distinct subsystem. Each reviewer read every source file within their domain scope, traced data flows across module boundaries, and evaluated correctness, security, performance, and maintainability.

### Review Process

1. **Full source read**: Every file in the domain scope was read completely, not sampled.
2. **Cross-reference check**: Dependencies and integration points between domains were traced (e.g., the trip planner API route's interaction with both the Neo4j planner and the in-memory Dijkstra, or the dual-mode hooks' interaction with both Socket.IO and React Query).
3. **Severity classification**: Each finding was classified as Critical (must fix before production), Important (should fix within next sprint), or Minor (nice to have / opportunistic).
4. **Actionable fixes**: Every finding includes specific file paths, line numbers, and suggested code changes.
5. **Architecture observations**: Cross-cutting patterns and systemic concerns were documented separately from individual findings.

### Synthesis

This health review package consolidates all findings from all six reviews into a unified severity-ranked list with deduplicated cross-domain findings (e.g., the CSV parser issue appearing in both Trip Planner and Map reviews, the Neo4j shortestPath issue appearing in both Trip Planner and Server reviews).

---

## Known Constraints

### Serverless on Vercel

- Each API route handler runs in its own Lambda instance with isolated module scope.
- In-memory caches (`Map`, module-level variables) do not persist across instances.
- Cold starts affect first-request latency; no warm-up mechanism.
- Function timeout limits apply to all API routes.

### Single-Instance WebSocket Server

- The WS server is designed for single-instance deployment.
- Module-level state (`previousTripIds`, `activeTripMap`, `subscriberCount`) is not externalized.
- Running multiple instances would produce duplicated metrics, incorrect subscriber counts, and duplicated `trains:remove` events.
- The Redis adapter makes Socket.IO broadcasting multi-instance safe, but the application-level state is not.

### Dual Data Clients

- Apollo Client handles GraphQL/AppSync analytics data.
- React Query handles all REST/MTA data.
- The two clients have separate caches with no coordination.
- `useOperationalStats` bridges both, creating complex loading state interactions.

### MTA Data Quality

- MTA GTFS-RT feeds can contain inconsistent trip IDs, missing stop sequences, and out-of-order timestamps.
- The feed loop and API routes have defensive parsing but some edge cases (midnight-crossing times, shuttle routes) are handled inconsistently.
- Static GTFS data (`stops.txt`, `stop_times.txt`) may contain quoted CSV fields that break naive parsers.

---

## Links to Individual Domain Reviews

Each individual review contains full detail including line-by-line code analysis, architecture diagrams, and domain-specific recommendations.

| Review | Location |
|--------|----------|
| API & Data Pipeline | [`dev/active/code-review/api-data-pipeline-code-review.md`](../../../active/code-review/api-data-pipeline-code-review.md) |
| Map Components & Hooks | [`dev/active/map-layer-review/map-layer-review-code-review.md`](../../../active/map-layer-review/map-layer-review-code-review.md) |
| Trip Planner Algorithm | [`dev/active/trip-planner-review/trip-planner-review-code-review.md`](../../../active/trip-planner-review/trip-planner-review-code-review.md) |
| Frontend UI & State | [`dev/active/frontend-deep-review/frontend-deep-review-code-review.md`](../../../active/frontend-deep-review/frontend-deep-review-code-review.md) |
| WebSocket Server | [`dev/active/server-deep-review/server-deep-review-code-review.md`](../../../active/server-deep-review/server-deep-review-code-review.md) |
| Test Infrastructure | [`dev/active/test-infra-review/test-infra-review-code-review.md`](../../../active/test-infra-review/test-infra-review-code-review.md) |
