Last Updated: 2026-02-23

# Full Codebase Review -- Task Checklist

## Tier 1: Critical (fix before next deploy)

### Security
- [ ] **Add input validation + rate limiting to conductor endpoints** -- Critical, M -- [Frontend C-1]
  - Add Zod schema validation with field length limits to `announce/route.ts`, `weather/route.ts`, `news/route.ts`
  - Call existing `checkRateLimit` from `src/lib/rate-limit.ts`
  - Files: `src/app/api/v1/conductor/announce/route.ts`, `weather/route.ts`, `news/route.ts`
- [ ] **Sanitize poiName URL param in SubwayMap popup** -- Critical, S -- [Frontend C-3]
  - Use existing `sanitizeHtml` from `src/lib/utils/sanitize.ts` before `setHTML`
  - File: `src/components/map/SubwayMap.tsx` (lines 300-304)
- [ ] **Re-enable rate limiting middleware** -- Critical, M -- [Frontend C-4]
  - Uncomment and tune the middleware in `src/middleware.ts` using the existing `checkRateLimit` infrastructure
  - File: `src/middleware.ts`
- [ ] **Remove Redis host port binding from production Docker Compose** -- Critical, S -- [Infra C-2]
  - Remove `ports: - "6379:6379"` from redis service; only accessed internally
  - File: `infra/docker-compose.prod.yml`
- [ ] **Remove Neo4j Bolt host port binding from production Docker Compose** -- Critical, S -- [Infra C-3]
  - Remove `ports: - "7687:7687"` from neo4j service; only accessed internally
  - File: `infra/docker-compose.prod.yml`
- [ ] **Activate HTTPS in nginx** -- Critical, M -- [Infra C-4]
  - Uncomment HTTPS server block, obtain Let's Encrypt certs, add HTTP-to-HTTPS redirect
  - File: `infra/nginx.conf`
- [ ] **Move AppSync API key to Secrets Manager** -- Critical, S -- [Infra C-1]
  - Remove `CfnOutput` for the API key, store in Secrets Manager instead
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 417-420)
- [ ] **Fix WsServerWriteRole IAM trust policy** -- Critical, S -- [Infra I-2]
  - Change `AccountPrincipal` to `ServicePrincipal('ec2.amazonaws.com')`, create Instance Profile
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 399-406)

### Reliability
- [ ] **Fix feed timeout = poll interval overlap** -- Critical, S -- [Server C-1]
  - Reduce `FEED_TIMEOUT_MS` to `10_000` or switch to self-scheduling `setTimeout` pattern
  - File: `server/src/ingestion/feed-loop.ts` (lines 28-29)
- [ ] **Fix metrics flush data-loss window** -- Critical, S -- [Server C-2]
  - Move `buffers.clear()` after successful `Promise.all` write, or keep snapshot for restore on failure
  - File: `server/src/analytics/metrics-collector.ts` (lines 724-754)
- [ ] **Fix activeTripMap cleanup ordering** -- Critical, S -- [Server C-3]
  - Run stale-trip cleanup after successful write, not before
  - File: `server/src/analytics/metrics-collector.ts` (lines 111, 300-330, 702-722)
- [ ] **Add DLQ to stream-to-s3 Lambda** -- Critical, M -- [Infra C-5]
  - Create SQS DLQ, add `bisectBatchOnError` + `reportBatchItemFailures`, fix parallel upload error handling
  - Files: `infra/cdk/lib/analytics-stack.ts` (lines 101-115), `infra/cdk/lambda/stream-to-s3/index.ts` (lines 59-88)

### Correctness
- [ ] **Fix fallback timer double-arming in dual-mode hooks** -- Critical, S -- [Frontend C-2]
  - Add `if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)` before every `setTimeout` assignment in disconnect branch
  - Files: `src/hooks/use-train-positions.ts`, `use-alerts.ts`, `use-arrivals.ts`
- [ ] **Fix useArrivals wrong-station unsubscribe** -- High, S -- [Frontend I-9]
  - Capture `prevStopIdRef.current` in a local variable before the cleanup closure runs
  - File: `src/hooks/use-arrivals.ts` (lines 116-124)
- [ ] **Fix useTrainMarkers async forEach** -- High, M -- [Frontend I-1]
  - Replace `forEach(async ...)` with `Promise.all` + mounted guard
  - File: `src/components/map/hooks/useTrainMarkers.ts` (line 394)

---

## Tier 2: Important (fix this sprint)

### Server
- [ ] **Add input length bounds to Socket.IO events** -- High, S -- [Server I-1]
  - Add `routeId.length > 10` guard to all three namespace handlers
  - Files: `server/src/namespaces/trains.ts`, `alerts.ts`, `arrivals.ts`
- [ ] **Add MTA API key to alert loop** -- High, S -- [Server I-2]
  - Read `process.env.MTA_API_KEY` and attach as `x-api-key` header
  - File: `server/src/ingestion/alert-loop.ts` (lines 198-202)
- [ ] **Add unhandledRejection/uncaughtException handlers** -- High, S -- [Server I-5]
  - Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` with pino logging
  - File: `server/src/index.ts`
- [ ] **Fix shortestPath Cypher query -- hop-optimal vs time-optimal** -- Medium, M -- [Server I-9]
  - Use `apoc.algo.dijkstra` if APOC is installed, or document the known limitation
  - File: `server/src/lib/queries/trip-planner.ts` (lines 57, 75)
- [ ] **Add Dockerfile HEALTHCHECK** -- Medium, S -- [Server I-4]
  - Add `HEALTHCHECK` instruction targeting `GET /` health endpoint
  - File: `server/Dockerfile`
- [ ] **Fix Redis main client asymmetric startup** -- Low, S -- [Server I-6]
  - Add startup connectivity log via `client.on('ready', ...)`
  - File: `server/src/lib/redis.ts` (lines 19-23)
- [ ] **Fix pino-pretty runtime availability** -- Low, S -- [Server I-7]
  - Move `pino-pretty` to `dependencies` or guard with `NODE_ENV === 'development'` strictly
  - File: `server/package.json`, `server/src/lib/logger.ts`
- [ ] **Remove unused cors dependency** -- Low, S -- [Server I-3]
  - Remove `cors` and `@types/cors` from `server/package.json`
  - File: `server/package.json`

### Frontend
- [ ] **Fix ConductorProvider timer leaks** -- Medium, S -- [Frontend I-5]
  - Store `setInterval` and recursive `setTimeout` IDs in refs and clear in cleanup
  - File: `src/components/conductor/ConductorProvider.tsx` (lines 190+)
- [ ] **Fix SocketProvider disconnectAll killing child hooks** -- Medium, M -- [Frontend I-2]
  - Remove `disconnectAll()` from SocketProvider cleanup, add individual namespace disconnect in each hook's cleanup
  - File: `src/components/providers/SocketProvider.tsx` (lines 63-68)
- [ ] **Remove/label fabricated analytics timeline** -- Medium, S -- [Frontend I-3]
  - Replace flat timeline with skeleton/empty state communicating "historical data unavailable"
  - File: `src/hooks/use-analytics.ts` (lines 84-103)
- [ ] **Fix useMapAnimation stale closure** -- Medium, S -- [Frontend I-4]
  - Add `options.refreshInterval` to all `useCallback` dependency arrays or use a ref
  - File: `src/components/map/hooks/useMapAnimation.ts` (lines 270-456)
- [ ] **Resolve train data dual source of truth** -- Medium, M -- [Frontend I-6]
  - Choose either hook state or Zustand as the single canonical source
  - Files: `src/hooks/use-train-positions.ts`, `src/stores/trains-store.ts`
- [ ] **Add POI coordinate bounds validation** -- Low, S -- [Frontend I-7]
  - Add NYC bounding box check before marker creation
  - File: `src/components/map/SubwayMap.tsx` (lines 272-314)
- [ ] **Consolidate duplicate rate-limit modules** -- Low, S -- [Frontend I-8]
  - Delete `src/lib/api/rate-limit.ts`, standardize on `src/lib/rate-limit.ts`
  - Files: `src/lib/rate-limit.ts`, `src/lib/api/rate-limit.ts`
- [ ] **Fix ArrivalBoard stopName null in WS path** -- Low, S -- [Frontend I-10]
  - Populate `stopName` from station lookup in the WS path, or ensure consumers handle `null`
  - File: `src/hooks/use-arrivals.ts` (lines 138-143)

### Infrastructure
- [ ] **Fix Glue alarm (wrong metric -> EventBridge rule)** -- High, M -- [Infra I-1]
  - Replace CloudWatch alarm on `numFailedTasks` with EventBridge rule on Glue job state change events
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 378-393)
- [ ] **Slim Dockerfile (omit devDeps)** -- Medium, S -- [Infra I-6]
  - Use `npm ci --omit=dev` for production stage
  - File: `server/Dockerfile`
- [ ] **Add .dockerignore** -- Medium, S -- [Infra I-7]
  - Create `server/.dockerignore` excluding `node_modules/`, `dist/`, `.env*`, test files
- [ ] **Add CDK synth to CI pipeline** -- Medium, M -- [Infra I-9]
  - Add a CI job that runs `npm ci`, `npm run build`, and `npx cdk synth --quiet`
  - File: `.github/workflows/ci.yml`
- [ ] **Add Lambda typecheck** -- Medium, S -- [Infra I-10]
  - Create `tsconfig.lambda.json` and add typecheck step in CDK CI job
  - File: `infra/cdk/tsconfig.json`
- [ ] **Add nginx container healthcheck** -- Medium, S -- [Infra I-5]
  - Add `healthcheck: test: ["CMD", "nginx", "-t"]` to nginx service
  - File: `infra/docker-compose.prod.yml`
- [ ] **Fix AppSync API key expiry -- add rotation mechanism** -- Medium, S -- [Infra I-11]
  - Switch to IAM authorization or add CloudWatch alarm + documented rotation procedure
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 230-237)
- [ ] **Add CI Docker build caching** -- Low, S -- [Infra I-8]
  - Add BuildKit cache with `docker/build-push-action@v5`
  - File: `.github/workflows/ci.yml`

---

## Tier 3: Minor (backlog)

### Frontend
- [ ] Add eslint-disable comment explaining SubwayMap map init deps -- Low, S -- [Frontend M-1]
  - File: `src/components/map/SubwayMap.tsx` (lines 242-244)
- [ ] Remove dead `_dashOffset` state -- Low, S -- [Frontend M-2]
  - File: `src/components/map/hooks/useTripRouteLayer.ts` (line 571)
- [ ] Remove shadowing module-level `refreshInterval` constant -- Low, S -- [Frontend M-3]
  - File: `src/components/map/hooks/useTrainMarkers.ts` (line 1084)
- [ ] Add error retry for `loadRouteTerminals` and `loadTrackUtils` -- Low, S -- [Frontend M-4]
  - File: `src/components/map/hooks/useTrainMarkers.ts` (lines 54-82, 121-138)
- [ ] Fix hardcoded `totalStations: 472` -- Low, S -- [Frontend M-5]
  - Use `useStaticData()` instead of hardcoded constant
  - File: `src/hooks/use-analytics.ts` (line 133)
- [ ] Fix ConductorProvider stale closure risk on function references -- Low, S -- [Frontend M-6]
  - File: `src/components/conductor/ConductorProvider.tsx` (lines 50-155)
- [ ] Extract `formatTimeRange` from AlertCard component body -- Low, S -- [Frontend M-7]
  - File: `src/components/alerts/AlertCard.tsx` (lines 33-56)
- [ ] Fix `feedStatus` memoization creating new `fallbackTimestamp` on every memo run -- Low, S -- [Frontend M-8]
  - File: `src/hooks/use-analytics.ts` (lines 107-118)

### Server
- [ ] Consolidate `CACHE_KEYS` registries -- Low, S -- [Server M-1]
  - Merge `cache.ts` keys with `cache-keys.ts` into a single registry
  - Files: `server/src/lib/cache.ts`, `server/src/lib/cache-keys.ts`
- [ ] Use streaming CSV parser for `stop_times.txt` -- Low, S -- [Server M-2]
  - Avoid ~70 MB peak memory during nightly rebuild
  - File: `server/src/analytics/schedule-lookup.ts` (lines 133-135)
- [ ] Add ICU dependency comment for `toLocaleTimeString` -- Low, S -- [Server M-3]
  - File: `server/src/ingestion/arrival-loop.ts` (lines 17-28)
- [ ] Read `MTA_API_KEY` once at module load instead of every fetch -- Low, S -- [Server M-4]
  - File: `server/src/ingestion/feed-loop.ts` (line 455)
- [ ] Fix `humanEta` producing "0m ago" for 31-59s past arrivals -- Low, S -- [Server M-5]
  - Return `'just left'` when `minAgo === 0`
  - File: `server/src/ingestion/arrival-loop.ts` (lines 33-39)
- [ ] Reset `previousTripIds` on `stopFeedLoop()` for testability -- Low, S -- [Server M-6]
  - File: `server/src/ingestion/feed-loop.ts` (lines 117, 133, 432)
- [ ] Separate production `node_modules` in Dockerfile -- Low, S -- [Server M-7]
  - Use `npm ci --omit=dev` for production stage (overlaps with Infra I-6)
  - File: `server/Dockerfile`
- [ ] Fix ETIMEDOUT classification in feed-loop -- Low, S -- [Server M-8 / Server I-8]
  - Check both `ECONNABORTED` and `ETIMEDOUT` codes
  - File: `server/src/ingestion/feed-loop.ts` (lines 490-492)

### Infrastructure
- [ ] Remove `ufw allow 3001/tcp` from production firewall rules -- Low, S -- [Infra M-1]
  - File: `infra/ec2-setup.sh` (line 39)
- [ ] Add source map to glue-trigger Lambda -- Low, S -- [Infra M-2]
  - File: `infra/cdk/lib/analytics-stack.ts` (line 204)
- [ ] Add comment explaining Glue Crawler schedule timing -- Low, S -- [Infra M-3]
  - File: `infra/cdk/lib/analytics-stack.ts` (line 186)
- [ ] Consider G.1X workers instead of maxCapacity DPU model -- Low, S -- [Infra M-4]
  - File: `infra/cdk/lib/analytics-stack.ts` (line 156)
- [ ] Document dev Docker Compose root-user risk -- Low, S -- [Infra M-5]
  - File: `docker-compose.v2.yml` (line 62)
- [ ] Replace broad `AWSGlueServiceRole` with inline policy -- Low, S -- [Infra M-6]
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 138-142)
- [ ] Add separate `tsconfig.lambda.json` for Lambda typechecking -- Low, S -- [Infra M-7]
  - File: `infra/cdk/tsconfig.json` (lines 27-30) (overlaps with Infra I-10)
- [ ] Verify Vercel cron route handlers exist -- Low, S -- [Infra M-8]
  - File: `vercel.json` (lines 3-11)
- [ ] Add S3 bucket encryption config -- Low, S -- [Infra I-4]
  - Add explicit `encryption`, `enforceSSL`, and `serverAccessLogsPrefix`
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 59-76)
- [ ] Add RollupsTable TTL -- Low, S -- [Infra I-3]
  - Add `timeToLiveAttribute: 'expireAt'`
  - File: `infra/cdk/lib/analytics-stack.ts` (lines 47-53)
- [ ] Use MERGE in seed-neo4j.ts for idempotent re-runs -- Low, S -- [Server I-10]
  - Change `CREATE` to `MERGE ... SET` in all node creation queries
  - File: `server/src/scripts/seed-neo4j.ts` (lines 248-257, 270-279)

---

## Summary

| Priority | Count |
|----------|-------|
| Critical | 16 |
| High | 7 |
| Medium | 16 |
| Low | 28 |
| **Total** | **67** |

### By Domain

| Domain | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| Frontend | 5 | 2 | 5 | 10 | 22 |
| Server | 3 | 3 | 2 | 13 | 21 |
| Infra | 8 | 2 | 9 | 5 | 24 |
| **Total** | **16** | **7** | **16** | **28** | **67** |

### Effort Estimates

| Size | Description | Count |
|------|-------------|-------|
| S | Single file, < 1 hour | 49 |
| M | Multi-file or complex logic, 1-4 hours | 18 |

### Recommended Sprint Allocation

- **Week 1**: All Tier 1 Critical items (16 tasks, ~20 hours estimated)
- **Week 2**: Tier 2 High + Medium items (23 tasks, ~25 hours estimated)
- **Backlog**: Tier 3 Minor items (28 tasks, ~15 hours estimated)
