Last Updated: 2026-02-23

# Full Codebase Review -- Railtime (Feb 2026)

## Executive Summary

The Railtime codebase demonstrates strong engineering fundamentals across all three tiers -- the Next.js frontend, the Node.js WebSocket server, and the AWS CDK infrastructure. The dual-mode WS/polling pattern, imperative MapLibre marker system, pino structured logging, and graceful degradation design are all production-quality patterns. The system currently serves real-time NYC subway tracking with ~150 trains across 8 GTFS-RT feeds every 15 seconds.

However, the review uncovered **12 critical issues**, **31 important improvements**, and **24 minor suggestions** across 3 domains. The most urgent risks are:

**Security (4 critical):**
1. Conductor AI proxy endpoints have no rate limiting or input validation -- unlimited OpenAI/ElevenLabs API charges possible
2. Redis and Neo4j ports are publicly exposed on EC2 with only password auth
3. HTTPS is entirely commented out in nginx -- all traffic is plaintext
4. AppSync API key emitted as plaintext CloudFormation output

**Reliability (3 critical):**
5. Feed loop timeout equals poll interval -- overlapping cycles corrupt removed-trip detection
6. Metrics flush clears buffers before async write completes -- 5 minutes of data lost on write failure
7. stream-to-s3 Lambda has no DLQ and creates duplicate S3 records on retry

**Correctness (3 high):**
8. Dual-mode hooks have fallback timer double-arming race condition
9. useArrivals unsubscribes wrong station on stopId change
10. useTrainMarkers forEach(async ...) creates unawaited promises that outlive component lifecycle

---

## Domain Reviews

### Frontend (src/)

The Railtime frontend is a thoughtfully architected real-time application with a high degree of engineering maturity. The dual-mode WebSocket/polling pattern is clearly structured, the imperative MapLibre marker system is well-separated from React's rendering cycle, and the Zustand/React Query boundary is correctly drawn. The two areas of greatest risk are security and operational correctness.

**4 Critical Issues:**

#### C-1: Conductor announce endpoint has no rate limiting, no input validation, and no body schema enforcement
- **File:** `src/app/api/v1/conductor/announce/route.ts` (lines 236-340)
- **Severity:** Critical
- The `POST /api/v1/conductor/announce` endpoint reads `request.json()` and passes the body directly to `generateAnnouncement`, which calls OpenAI chat completions and then `synthesizeSpeech` (OpenAI TTS). There is no rate limit check per IP, no maximum length on `stationName`, `headsign`, `poiName`, or `crossStreet`, no schema validation, and no authentication. A single unauthenticated caller can trigger unlimited OpenAI API calls. The same gap exists in `src/app/api/v1/conductor/weather/route.ts` and `src/app/api/v1/conductor/news/route.ts`.
- **Fix:** Add Zod schema validation at the top of the handler, enforce field length limits, and call the existing `checkRateLimit` from `src/lib/rate-limit.ts`.

```ts
const AnnounceBodySchema = z.object({
  routeId: z.string().min(1).max(3).regex(/^[A-Z0-9]+$/i),
  stationName: z.string().min(1).max(100),
  stationId: z.string().max(10).optional(),
  headsign: z.string().max(100).optional(),
  poiName: z.string().max(100).optional(),
  crossStreet: z.string().max(100).optional(),
  direction: z.string().max(10).optional(),
  announcementType: z.enum(ANNOUNCEMENT_TYPES).optional(),
});
```

#### C-2: Fallback timer double-arming race condition in dual-mode hooks
- **Files:** `src/hooks/use-train-positions.ts` (lines 87-107), `src/hooks/use-alerts.ts` (lines 99-113), `src/hooks/use-arrivals.ts` (lines 96-113)
- **Severity:** Critical
- In the socket lifecycle `useEffect`, the disconnect branch creates a `fallbackTimerRef.current` without first checking whether one already exists. In React 19 concurrent rendering scenarios, two overlapping timers can both call `setSocketActive(false)` and `queryClient.invalidateQueries`, firing duplicate polling invalidations.
- **Fix:** Clear before setting in the disconnect branch:

```ts
} else {
  if (disconnectedAtRef.current === null) {
    disconnectedAtRef.current = Date.now();
  }
  if (fallbackTimerRef.current) {
    clearTimeout(fallbackTimerRef.current);
  }
  fallbackTimerRef.current = setTimeout(() => {
    setSocketActive(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.trains });
  }, FALLBACK_DELAY_MS);
}
```

#### C-3: POI popup in SubwayMap inserts unsanitized URL parameter content into the DOM
- **File:** `src/components/map/SubwayMap.tsx` (lines 300-304)
- **Severity:** Critical
- The `poiName` query parameter from the URL is inserted into a MapLibre popup `setHTML` call without sanitization. MapLibre's `setHTML` sets `innerHTML` directly. This is a stored-URL XSS vector, exploitable via shared links.
- **Fix:** Sanitize before interpolation using the existing `sanitizeHtml` utility from `src/lib/utils/sanitize.ts`.

#### C-4: Rate limiting is entirely disabled at the middleware layer
- **File:** `src/middleware.ts` (lines 8-11)
- **Severity:** Critical
- The project has two well-implemented rate-limiting modules (`src/lib/rate-limit.ts`, `src/lib/api/rate-limit.ts`) and a proper `RATE_LIMITS` configuration. They are dead code as long as middleware passes all requests unconditionally. All API routes are fully open to abuse.
- **Fix:** Re-enable middleware with the existing `checkRateLimit` infrastructure, tuned to the real-time polling frequency.

**10 Important Issues:**

#### I-1: `useTrainMarkers` effect fires `async/await` inside `forEach`
- **File:** `src/components/map/hooks/useTrainMarkers.ts` (line 394)
- **Severity:** High
- `Array.prototype.forEach` ignores the return value of its callback. The `await` calls inside run, but the `useEffect` body has already completed. If the component unmounts while async operations are in flight, they will still resolve and attempt to mutate `trainMotionRef.current` and add markers to the (now-removed) map.
- **Fix:** Replace `forEach(async ...)` with a `Promise.all` over an async IIFE guarded by a mounted flag.

#### I-2: `disconnectAll()` in SocketProvider cleanup disconnects namespace sockets owned by child hooks
- **File:** `src/components/providers/SocketProvider.tsx` (lines 63-68)
- **Severity:** Medium
- When `SocketProvider` unmounts, it kills all namespace sockets, but the child hook effects have already captured stale socket references and will not reconnect because their `isAvailable` effect deps have not changed. After a SocketProvider re-mount, the three data hooks remain in a zombie state.
- **Fix:** Remove `disconnectAll()` from the SocketProvider cleanup, and add explicit namespace socket disconnect in each hook's cleanup.

#### I-3: `use-analytics.ts` generates fabricated timeline data presented as real historical data
- **File:** `src/hooks/use-analytics.ts` (lines 84-103)
- **Severity:** Medium
- The arrivals timeline chart will render a flat horizontal line at the current train count for all 12 time points going back 1 hour. This looks like real historical data to users but is meaningless. The `avgDelay` is hardcoded to `2`.
- **Fix:** Replace with explicit placeholder UI that communicates "historical data unavailable", or remove the fields.

#### I-4: `useMapAnimation` stale closure for `animateTrains`
- **File:** `src/components/map/hooks/useMapAnimation.ts` (lines 270-456)
- **Severity:** Medium
- `options.refreshInterval` is captured at creation time. The `hasMovingTrains` callback captures `options.refreshInterval` without it being in its deps.
- **Fix:** Pass `refreshInterval` as a `useRef` or add it to all `useCallback` dependency arrays.

#### I-5: `ConductorProvider` leaks `setInterval` for news and `setTimeout` chains for hourly weather
- **File:** `src/components/conductor/ConductorProvider.tsx` (lines 190-186)
- **Severity:** Medium
- The `setInterval` for news and the recursive `setTimeout` chain for hourly weather are never cleared on unmount. In Next.js App Router, components can remount, creating duplicate interval/timer stacks with each mount.
- **Fix:** Store all timer IDs in refs and clear them in the cleanup.

#### I-6: `trainPositions` data source split between hook state and Zustand store
- **Files:** `src/hooks/use-train-positions.ts` (lines 120-128), `src/components/map/SubwayMap.tsx` (line 63)
- **Severity:** Medium
- The hook both writes to the Zustand store (`updateTrains`) AND returns `socketTrains`/`query.data.trains` directly. The map uses hook return value; other components may use the store. These can be one render behind each other.
- **Fix:** Choose one source of truth. Either make the hook the authority or make Zustand the authority.

#### I-7: POI marker coordinates have no bounds validation
- **File:** `src/components/map/SubwayMap.tsx` (lines 272-314)
- **Severity:** Low
- A URL `?poi=999,999` will call `flyTo` with out-of-bounds coordinates and trigger a MapLibre error.
- **Fix:** Add a NYC bounding box check before marker creation.

#### I-8: Two duplicate rate-limit modules with different APIs
- **Files:** `src/lib/rate-limit.ts`, `src/lib/api/rate-limit.ts`
- **Severity:** Low
- Both exist, neither is called from middleware (which is disabled). The duplication increases the chance of only partially enabling rate limiting.
- **Fix:** Pick one module and delete the other.

#### I-9: `useArrivals` unsubscribes from the wrong `stopId` on cleanup when `stopId` changes
- **File:** `src/hooks/use-arrivals.ts` (lines 116-124)
- **Severity:** High
- When `stopId` changes, the effect cleanup runs and emits `unsubscribe:station` for `prevStopIdRef.current`. But `prevStopIdRef.current` at cleanup time is the NEW stop (just set by the lifecycle effect), not the old one. The wrong stop gets unsubscribed.
- **Fix:** Capture the stop to unsubscribe before it changes by storing in a local variable.

#### I-10: `ArrivalBoard.stopName` is set to `null` by socket path
- **File:** `src/hooks/use-arrivals.ts` (lines 138-143)
- **Severity:** Low
- The polling path populates `stopName` from the API response. The WS path always sets it to `null`. Any component that uses `arrivals.stopName` will render nothing in WS mode.

---

### Server (server/src/)

The WebSocket server is well-structured for its size and scope. The layering of ingestion loops, namespace handlers, analytics, and library helpers is clean and consistent. Graceful degradation (Redis-optional, Neo4j-optional, DynamoDB-optional) is implemented thoroughly, and the shutdown sequence is thoughtful. The use of pino structured logging, ioredis, and the Socket.IO Redis adapter follows industry norms.

**3 Critical Issues:**

#### C-1: Feed timeout equals poll interval -- overlapping cycles possible
- **File:** `server/src/ingestion/feed-loop.ts` (lines 28-29)
- **Severity:** Critical
- `POLL_INTERVAL_MS` and `FEED_TIMEOUT_MS` are both `15_000`. If all 8 feeds are slow, `runCycle()` can take up to 15s. The next interval fires while the previous cycle is still awaiting. Two cycles can be live simultaneously, both writing to Redis and calling `onUpdate` concurrently, doubling feed-loop traffic and causing ghost "removed trip" events.
- **Fix:** Reduce `FEED_TIMEOUT_MS` to `10_000` or replace `setInterval` with a self-scheduling pattern that awaits the previous cycle.

#### C-2: Metrics data loss -- buffers cleared before async write completes
- **File:** `server/src/analytics/metrics-collector.ts` (lines 724-754)
- **Severity:** Critical
- `buffers.clear()` runs before `Promise.all([writeMetrics(...)])`. If the write throws, the catch block logs the error and continues. The data that was in `buffers` has already been cleared from memory and will never be written to DynamoDB. Five minutes of metrics are silently dropped.
- **Fix:** Clear buffers only after a successful write, or keep a snapshot and restore on failure.

#### C-3: `activeTripMap` cleanup ordering risk during DynamoDB write failures
- **File:** `server/src/analytics/metrics-collector.ts` (lines 111, 300-330)
- **Severity:** Critical
- If DynamoDB is configured but its write is failing (throwing, not returning null), `flush()` runs but exits at the `writeMetrics` throw. The stale-trip cleanup runs and deletions happen before the write. Map deletions are irreversible and the TRIP_END events are never written.
- **Fix:** Run stale-trip cleanup after a successful write, not before.

**10 Important Issues:**

#### I-1: No input length bounding on Socket.IO subscription payloads
- **Files:** `server/src/namespaces/trains.ts` (line 72), `alerts.ts` (line 46), `arrivals.ts` (line 67)
- **Severity:** High
- Handlers validate `typeof routeId === "string"` but do not cap length. A malicious client can send a 1 MB string as a `routeId`, creating an equally large room name.
- **Fix:** Add `routeId.length > 10` guard. Station IDs should be bounded similarly (max 20 characters).

#### I-2: Alert loop does not send MTA API key
- **File:** `server/src/ingestion/alert-loop.ts` (lines 198-202)
- **Severity:** High
- The feed loop correctly reads `process.env.MTA_API_KEY` and attaches it. The alert loop does not. The MTA may begin returning 401/403 without warning.
- **Fix:** Add `x-api-key` header to the alert loop requests.

#### I-3: `cors` package is a dead dependency
- **File:** `server/package.json`
- **Severity:** Low
- Neither `cors` nor `@types/cors` are imported anywhere in `server/src/`. CORS is handled manually in `index.ts`.
- **Fix:** Remove both packages.

#### I-4: Dockerfile has no HEALTHCHECK instruction
- **File:** `server/Dockerfile`
- **Severity:** Medium
- The server has a health endpoint at `GET /` but the Dockerfile does not declare a `HEALTHCHECK`. Docker cannot distinguish a crashed container from a healthy one.
- **Fix:** Add `HEALTHCHECK` instruction targeting the health endpoint.

#### I-5: No `unhandledRejection` / `uncaughtException` handlers
- **File:** `server/src/index.ts`
- **Severity:** High
- The server registers `SIGINT` and `SIGTERM` handlers but not `process.on('unhandledRejection')` or `process.on('uncaughtException')`. Node.js will crash the process on unhandled rejections since Node 15.
- **Fix:** Add handlers that log via pino and then `process.exit(1)`.

#### I-6: Redis main client is never explicitly connected (relying on ioredis auto-connect)
- **File:** `server/src/lib/redis.ts` (lines 19-23)
- **Severity:** Low
- With `lazyConnect: true` and `enableOfflineQueue: false`, the first command can silently fail. Pub/sub clients are explicitly `await connect()`-ed but the main client is not.
- **Fix:** Add a startup connectivity log for the main client.

#### I-7: `pino-pretty` in devDependencies but required at runtime in non-production
- **File:** `server/package.json`, `server/src/lib/logger.ts`
- **Severity:** Low
- The transport is configured when `NODE_ENV !== 'production'`. A staging deployment with `NODE_ENV=staging` would fail.
- **Fix:** Move to `dependencies` or guard with `NODE_ENV === 'development'` strictly.

#### I-8: Timeout classification misses `ETIMEDOUT`
- **File:** `server/src/ingestion/feed-loop.ts` (lines 490-492)
- **Severity:** Low
- Axios uses `ECONNABORTED` for request-body timeouts but `ETIMEDOUT` for connection-establishment timeouts. A hung TCP connection to the MTA API will be classified as `"error"` rather than `"timeout"`.
- **Fix:** Check both `ECONNABORTED` and `ETIMEDOUT`.

#### I-9: `shortestPath` in Cypher finds hop-optimal, not time-optimal paths
- **File:** `server/src/lib/queries/trip-planner.ts` (lines 57, 75)
- **Severity:** Medium
- Cypher's `shortestPath` finds the path with the fewest relationships (hops), not the minimum total `duration`. The post-filter re-orders results, but `shortestPath` may have already discarded the time-optimal path.
- **Fix:** Use `apoc.algo.dijkstra` if APOC is installed, or document the known limitation.

#### I-10: `seed-neo4j.ts` uses `CREATE` instead of `MERGE`
- **File:** `server/src/scripts/seed-neo4j.ts` (lines 248-257, 270-279)
- **Severity:** Low
- Re-running without `--clean` will throw a constraint violation on every node. The script will crash mid-way through, leaving the graph in a partial state.
- **Fix:** Use `MERGE ... SET` for idempotency.

---

### Infrastructure (infra/)

The Railtime infrastructure is a well-structured two-tier deployment: a CDK-managed analytics pipeline on AWS (DynamoDB, S3, Glue, AppSync, Lambda) and a Docker Compose cluster on a single EC2 t3.small. The overall architecture is sensible for the scale -- PAY_PER_REQUEST billing, TTL on hot tables, multi-stage Docker builds, and meaningful CloudWatch alarms are all positive signs.

**5 Critical Issues:**

#### C-1: AppSync API key emitted in plaintext CloudFormation output
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 417-420)
- **Severity:** Critical
- Anyone with `cloudformation:DescribeStacks` IAM access can read this key. It will also appear in CDK deploy terminal output in plaintext.
- **Fix:** Store in AWS Secrets Manager during deployment.

#### C-2: Redis port 6379 is bound to 0.0.0.0 (publicly accessible)
- **File:** `infra/docker-compose.prod.yml` (lines 38-39)
- **Severity:** Critical
- Redis is exposed directly on the EC2 public IP. The `${REDIS_PASSWORD:-}` default makes the password empty if the env var is unset, meaning unauthenticated access is possible.
- **Fix:** Remove the host port binding entirely. Only ws-server needs access via the Docker internal network.

#### C-3: Neo4j Bolt port 7687 is bound to 0.0.0.0 (publicly accessible)
- **File:** `infra/docker-compose.prod.yml` (lines 7-9)
- **Severity:** Critical
- Same issue as Redis. The Bolt port is exposed on the public EC2 IP, protected only by the `${NEO4J_PASSWORD}` value.
- **Fix:** Remove the host port binding. ws-server connects over the internal Docker network.

#### C-4: HTTPS is not active -- all traffic is plaintext HTTP
- **File:** `infra/nginx.conf` (lines 74-85)
- **Severity:** Critical
- The entire HTTPS server block is commented out. Socket.IO connections and all API traffic are transmitted in plaintext. WebSocket traffic over `ws://` is trivially interceptable.
- **Fix:** Obtain TLS certificates (Let's Encrypt via certbot) and activate the HTTPS block.

#### C-5: stream-to-s3 Lambda has no Dead Letter Queue and partial-failure handling is incorrect
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 101-115), `infra/cdk/lambda/stream-to-s3/index.ts` (lines 59-88)
- **Severity:** Critical
- No DLQ is configured on either `DynamoEventSource`, so if the Lambda exhausts its retries the records are silently dropped. When `Promise.all(uploads)` rejects (one S3 write fails), the Lambda throws and retries the entire batch, but the successful upload already wrote, creating duplicate data in S3 that Glue will double-count in rollups.
- **Fix:** Add a DLQ, use `bisectBatchOnError` + `reportBatchItemFailures`, and write each type independently with separate try/catch.

**11 Important Issues:**

#### I-1: Glue job alarm watches the wrong CloudWatch metric
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 378-393)
- **Severity:** High
- `glue.driver.aggregate.numFailedTasks` measures Spark task failures within a job run. A Glue job can have failed tasks but still succeed overall. The alarm will miss job-level failures and potentially false-alarm on transient task retries.
- **Fix:** Replace with an EventBridge rule targeting Glue job state change events (FAILED, ERROR, TIMEOUT).

#### I-2: WsServerWriteRole uses AccountPrincipal -- no service scoping
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 399-406)
- **Severity:** Critical
- `new iam.AccountPrincipal(this.account)` allows any IAM principal in the AWS account to assume this role. The intent is for the EC2 instance to assume it.
- **Fix:** Use `new iam.ServicePrincipal('ec2.amazonaws.com')` and attach the role to an instance profile.

#### I-3: RollupsTable has no TTL configured
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 47-53)
- **Severity:** Low
- Rollup records grow indefinitely. Inconsistent with the TTL pattern used on the other two tables.
- **Fix:** Add a `timeToLiveAttribute: 'expireAt'`.

#### I-4: S3 bucket has no explicit server-side encryption configured
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 59-76)
- **Severity:** Low
- AWS S3 encrypts at rest by default since 2023, but this is not explicitly declared. No access logging is configured.
- **Fix:** Add `encryption: s3.BucketEncryption.S3_MANAGED`, `enforceSSL: true`, and `serverAccessLogsPrefix`.

#### I-5: Nginx container has no healthcheck or restart awareness
- **File:** `infra/docker-compose.prod.yml` (lines 103-118)
- **Severity:** Medium
- No way to distinguish "restarting because healthy" from "restarting because broken" in monitoring.
- **Fix:** Add `healthcheck: test: ["CMD", "nginx", "-t"]`.

#### I-6: Dockerfile copies all node_modules including devDependencies into production image
- **File:** `server/Dockerfile` (line 23)
- **Severity:** Medium
- The production stage copies `node_modules` from `deps` which includes `tsx`, `pino-pretty`, and TypeScript, adding 80-120 MB to the production image.
- **Fix:** Use a separate `npm ci --omit=dev` step for the production image.

#### I-7: No .dockerignore -- entire server directory sent as build context
- **File:** `server/Dockerfile`
- **Severity:** Medium
- Without `.dockerignore`, `docker build` sends `dist/`, `node_modules/`, test files, and any `.env` files.
- **Fix:** Create `server/.dockerignore` excluding `node_modules/`, `dist/`, `.env*`, and test files.

#### I-8: CI pipeline has no caching for the Docker build job
- **File:** `.github/workflows/ci.yml` (lines 43-49)
- **Severity:** Low
- All three stages rebuild from scratch on every CI run, adding 2-3 minutes of unnecessary build time.
- **Fix:** Add BuildKit cache with `docker/build-push-action@v5`.

#### I-9: CI pipeline has no CDK synth or lint step
- **File:** `.github/workflows/ci.yml`
- **Severity:** Medium
- The CDK package in `infra/cdk/` has no CI validation. A broken stack would only be discovered at deploy time.
- **Fix:** Add a CDK job that runs `npm ci`, `npm run build`, and `npx cdk synth --quiet`.

#### I-10: Lambda TypeScript files are never typechecked by `tsc` in CI
- **File:** `infra/cdk/tsconfig.json` (lines 27-30)
- **Severity:** Medium
- The `lambda/` directory is excluded from CDK's TypeScript compilation. Type errors in Lambda handlers will not be caught until CDK deploy.
- **Fix:** Add a separate `tsconfig.lambda.json` and a typecheck step in CI.

#### I-11: AppSync API key expires after 365 days with no rotation mechanism
- **File:** `infra/cdk/lib/analytics-stack.ts` (lines 230-237)
- **Severity:** Medium
- When it expires, the API becomes unavailable. There is no alarm, no rotation, and no documented process for renewal.
- **Fix:** Use IAM authorization for production, or add a CloudWatch alarm and document the rotation procedure.

---

## Cross-Cutting Concerns

### Rate Limiting Architecture

The middleware rate limiter is disabled, the conductor endpoints have no protection, and the server HTTP endpoint has no throttling. Three separate rate-limiting implementations exist but none are active:

1. `src/lib/rate-limit.ts` -- path-based config lookup (disabled by middleware bypass)
2. `src/lib/api/rate-limit.ts` -- caller-provided config (never imported)
3. `infra/nginx.conf` -- `limit_req_zone` applied to `location /` but not `location /socket.io/`

### Dual Source of Truth for Train Data

Train positions live in both `useTrainPositions` hook state and the Zustand `trainsStore`. The map reads from the hook; other components may read from the store. These can be one render behind each other, creating visual inconsistency.

### Single EC2 Single Point of Failure

The entire backend runs on one t3.small with no replication. EBS failure = total outage. No automated EBS snapshots or standby instance.

### Socket Client Module Singletons

The socket client (`src/lib/socket/client.ts`) uses module-level mutable singletons (`let socket`, `const namespaceSockets`). In development with Turbopack hot reload, module singletons persist across hot reloads while React component trees are rebuilt, creating scenarios where hooks receive already-connected sockets without proper event handler setup.

---

## Testing Gaps

- 0 tests for `SubwayMap.tsx` (highest blast-radius component)
- 0 tests for all 3 conductor API endpoints (highest-cost endpoints)
- 0 tests for analytics dashboard components
- 0 tests for `useStationMarkers`, `useTripRouteLayer` hooks
- 0 tests for `calculateTrainPositions` in `src/lib/mta/train-positions.ts`
- 0 tests for `geolocation-store.ts`
- 0 tests for `src/app/api/v1/trains/route.ts`
- WS socket paths in dual-mode hooks are not tested (mocks return `isAvailable: false`)
- `use-train-positions-ws.test.ts` mock contract does not match real `connectNamespaceSocket` behavior
- CDK stack has no CI validation (no `cdk synth` in pipeline)
- Lambda handlers excluded from TypeScript compilation
- Neo4j-to-in-memory fallback path in trip API is not tested

---

## Statistics

| Severity | Frontend | Server | Infra | Total |
|----------|----------|--------|-------|-------|
| Critical | 4 | 3 | 5 | **12** |
| Important | 10 | 10 | 11 | **31** |
| Minor | 8 | 8 | 8 | **24** |
| **Total** | **22** | **21** | **24** | **67** |

Files reviewed: ~140 across 3 domains (Frontend: ~100+ files under `src/`, Server: 21 files under `server/src/`, Infrastructure: 4 CDK files, 2 Lambda handlers, 2 Docker Compose files, nginx, CI pipeline, Dockerfile).
