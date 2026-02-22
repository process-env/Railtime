# Handoff Notes

_Last Updated: 2026-02-22_

---

## Session: Bedrock Transit Analysis (2026-02-22, afternoon)

**Goal:** Replace EquipmentStatusCard with AI-powered transit analysis card using Amazon Bedrock Nova Micro.

### What Was Completed (before Bedrock work, same day)
- Code review remediation deployed (`f032848`), pushed, deployed to Vercel
- AWS IAM instance profile set up for EC2 DynamoDB access (role: `railtime-ec2-dynamodb`)
- DynamoDB duplicate key fix — sub-millisecond counters for TRIP_START/TRIP_END (`a13ea5a`)
- Wired TripCompletionChart to real rollup data (bar chart by route) (`4fdae44`)
- Wired DelayDistributionChart to real 7-day rollup data (pie chart)
- LiveSystemDashboard rewritten to use real feed status props instead of broken AppSync query (`c3a5c0e`)
- ArrivalsTimelineChart rewritten as self-contained 7-Day Trip Trends (ComposedChart) (`c3a5c0e`)
- Server metrics-collector enriched with feedGroupData + alertCount in SYSTEM_HEALTH record (`c3a5c0e`)
- VTL resolver `getLatestSystemHealth.res.vtl` fixed to parse real data (`c3a5c0e`)
- Replaced duplicate FeedStatusCard with BestWorstRouteCard (`299edec`)
- Animated RidershipAnimationCard with rush hour speed simulation (`1fc2150`, `6faff0b`)
- WS server rebuilt on EC2 (new IP: `54.88.1.202`, user: `ubuntu`, path: `/opt/railtime`)
- Data lake confirmed active: 1073+ files in S3 bucket `railtime-analytics-{account}`

**Commits (earlier today):**
- `f032848` — code review remediation (16 fixes)
- `bfad234` — remove empty AWS env vars from docker-compose
- `a13ea5a` — fix DynamoDB duplicate key errors
- `4fdae44` — wire TripCompletionChart + DelayDistributionChart
- `c3a5c0e` — wire analytics to real data, fix LiveSystemDashboard + ArrivalsTimeline
- `299edec` — replace FeedStatusCard with BestWorstRouteCard
- `1fc2150` — animated ridership counter
- `6faff0b` — animation plays once on load

### What's Being Built (this task)

**Architecture**: WS server HTTP endpoint → DynamoDB query → Bedrock Nova Micro → Redis cache → Frontend card

Files created/modified:
- `server/src/api/transit-analysis.ts` — NEW: Bedrock analysis endpoint
- `server/src/index.ts` — Wire HTTP route for /api/transit-analysis
- `src/components/analytics/TransitAnalysisCard.tsx` — NEW: Frontend card
- `src/components/analytics/index.ts` — Add barrel export
- `src/app/(dashboard)/analytics/page.tsx` — Swap EquipmentStatusCard → TransitAnalysisCard

### EC2 Details (updated)
- IP: `54.88.1.202`
- User: `ubuntu`
- Path: `/opt/railtime`
- SSH: `ssh -i ~/.ssh/railtime.pem ubuntu@54.88.1.202`

### What's Next
- Add `bedrock:InvokeModel` permission to EC2 IAM role (`railtime-ec2-dynamodb`)
- Rebuild WS server on EC2
- Test with `curl http://localhost:3001/api/transit-analysis` on EC2
- Deploy frontend to Vercel

---

## Session: Code Review Remediation (2026-02-22)

**Goal:** Full codebase code review post-analytics-supercharge, followed by leaf-to-core remediation.

### What Was Completed (Prior to This Session)

#### Analytics Supercharge (same day, earlier session)
- **Trip lifecycle logging**: TRIP_START/TRIP_END events tracked in `metrics-collector.ts` via `activeTripMap`
- **GraphQL trip events**: New `getTripEvents` query + resolver + `TripEvent` type in AppSync schema
- **5-tab analytics dashboard**: System Overview, Route Performance, Ridership & Impact, Trip Intelligence, Schedule & Stations
- 22 analytics components wired into tabbed layout at `src/app/(dashboard)/analytics/page.tsx`
- **Hotfix**: Invalid Date crash in TrainHistoryChart — switched to ISO timestamps

**Commits:**
- `7289e74` — feat: trip lifecycle logging, GraphQL trip events, 5-tab analytics dashboard
- `bf6232f` — fix: pass ISO timestamps to TrainHistoryChart to prevent Invalid Date crash

Both deployed to Vercel production (`traintracker-kappa.vercel.app`).

#### Code Review
Full code review across Next.js app (src/), WS server (server/src/), CDK infrastructure (infra/cdk/), and build scripts. **54 issues** found across 3 domains:
- Frontend: 18 issues (dynamic Tailwind classes, missing error boundaries, unmemoized filters)
- Server: 24 issues (race conditions, silent data loss, missing error handling)
- Infrastructure: 12 issues (IAM over-permissions, missing env validation, incomplete build scripts)

**16 issues prioritized** for immediate fix in a leaf-to-core remediation plan.

### What's Being Fixed (This Session)

**Phase 1 — Leaf (low blast-radius):**
- Dynamic Tailwind classes in chart empty states
- ArrivalsTimelineChart dynamic `require()` → static import
- Lambda env var validation + error handling
- `build:data` script chained to include all 4 build scripts

**Phase 2 — Hooks/API (medium blast-radius):**
- `parseInt` NaN bug in trip API route
- Error swallowing in `useTripPlanner` hook
- Memoize `RoutePerformanceTable` filter
- Apollo noop link silent failure logging

**Phase 3 — Core (high blast-radius):**
- Protobuf decode error handling in feed-loop
- Metrics-collector flush race condition (async interleaving guard)
- DynamoDB client shutdown on server close
- Glue IAM over-permissions removed
- React error boundaries at 3 strategic points
- Neo4j hop limit increased from 30 to 50
- DynamoDB writer escalation on max retries

### Decisions Made and Why

| Decision | Rationale |
|----------|-----------|
| Fix 16 of 54 issues | Focused on real bugs and high-value improvements; skipped nitpicks and low-risk cosmetic issues |
| Leaf-to-core ordering | Minimize risk by fixing isolated components first, then shared code |
| Simple flush guard (not mutex) | Node.js single-threaded — `let flushing = false` prevents async interleaving during DynamoDB writes |
| Error boundaries at tab level | One tab crashing shouldn't kill the analytics dashboard |

### Known Issues / Things to Watch
1. **38 deferred issues** from code review — tracked in `dev/active/code-review/code-review-context.md`
2. **DynamoDB writer throws on max retries** (new behavior) — monitor for false positives

### What's Next
- Run TypeScript compilation, tests, and build verification across all packages
- Deploy: `vercel --prod --yes`
- Monitor DynamoDB writes for retry escalation behavior

---

## Session: Redis Caching & Instant Load (2026-02-21)

**Goal:** Reduce initial train load time from ~30s to <3s. Achieved ~2s.

**Commit:** `12c8684` on `main`

### What Was Completed

#### 1. Instant emit on socket subscribe (`server/src/namespaces/trains.ts`)

When a client emits `subscribe:all`, the server now reads all 8 `feed:{groupId}:positions` keys from Redis via `getCachedPositions()` and emits `trains:update` per group back to the subscribing socket immediately. Previously the client had to wait 0-15s for the next feed cycle broadcast.

#### 2. Reduced fallback delay (`src/hooks/use-train-positions.ts`)

`FALLBACK_DELAY_MS` changed from 30,000ms to 5,000ms. If WebSocket fails, polling starts in 5s instead of 30s.

#### 3. Redis-backed polling API (`src/app/api/v1/trains/route.ts`)

Added `tryRedisCache()` that reads pre-computed positions from Redis (same keys the WS server writes). Cache hit returns immediately with `source: "cache"` (~150ms). Cache miss falls through to the existing MTA fetch with `source: "mta"` (8-15s).

#### 4. Opened Redis port 6379 on EC2

- AWS security group `sg-0c90a41a7877adf8f` -- rule `sgr-0306ff7337ca24349`
- UFW firewall on EC2 -- `sudo ufw allow 6379/tcp`
- Redis has password auth (`railtime-redis`)

#### 5. Fixed `NEXT_PUBLIC_WS_URL` Vercel env var

The value had a trailing `\n` causing Socket.IO connection to fail silently. Initially tried `http://54.88.1.202:3001` but that caused mixed-content blocking (HTTPS page to HTTP WebSocket). Corrected to `https://54-88-1-202.sslip.io` -- Caddy reverse proxy already running on EC2 with auto-TLS via sslip.io.

#### 6. Redeployed WS server on EC2

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.v2 up -d --build ws-server
```

Note: Docker nginx service is NOT running (port 80/443 conflict with Caddy). Caddy handles TLS instead.

### Decisions Made and Why

| Decision | Rationale |
|----------|-----------|
| Caddy over Docker nginx | Caddy was already running on EC2 with auto-TLS for `54-88-1-202.sslip.io` to localhost:3001. Docker nginx was trying to bind the same ports and failing. Kept Caddy since it works. |
| Redis port open to 0.0.0.0/0 | Acceptable because Redis has password auth. For production hardening, should restrict to Vercel IP ranges. |
| Partial cache = miss | If any of the 8 feed group Redis keys returns null, the entire cache lookup is treated as a miss. This avoids serving incomplete data. |

### Performance Results

| Scenario | Before | After |
|----------|--------|-------|
| WS up, Redis warm | 0-15s | ~2s |
| WS down, Redis warm | 38-45s | ~5s |
| WS down, Redis down | 38-45s | ~15s |
| `/api/v1/trains` direct | 8-15s | ~150ms (cache) |

### Known Issues / Things to Watch

1. **Duplicate `subscribe:all`**: WS logs show each client emitting `subscribe:all` twice (causing two Redis reads and two sets of emits). Not harmful but wasteful. The `useTrainPositions` hook's effect dependency array may be causing this.

2. **Docker nginx disabled**: The `infra-nginx-1` container fails to start because Caddy holds ports 80/443. Either remove nginx from `docker-compose.prod.yml` or remove Caddy and use Docker nginx exclusively.

3. **Redis 0.0.0.0/0**: Should be locked down to Vercel's IP ranges for production hardening.

4. **`ALLOWED_ORIGINS` on WS server**: Currently has 3 origins. New Vercel preview deployments will not be able to connect to WebSocket unless added.

### What's Next

- Neo4j graph-based trip planner (separate follow-up -- Neo4j is deployed but not yet leveraged for pathfinding)
- Clean up the duplicate `subscribe:all` emission in the `useTrainPositions` hook
- Consider removing Docker nginx from compose file since Caddy handles reverse proxy
- Lock down Redis security group to Vercel IP ranges
