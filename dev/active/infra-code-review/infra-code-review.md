Last Updated: 2026-02-23

# infra — Infrastructure Code Review

## Executive Summary

The Railtime infrastructure is a well-structured two-tier deployment: a CDK-managed analytics pipeline on AWS (DynamoDB, S3, Glue, AppSync, Lambda) and a Docker Compose cluster on a single EC2 t3.small (Neo4j, Redis, Socket.IO server, nginx). The overall architecture is sensible for the scale — PAY_PER_REQUEST billing, TTL on hot tables, multi-stage Docker builds, and meaningful CloudWatch alarms are all positive signs of deliberate engineering.

However, there are several security issues that need immediate attention before this system handles production traffic. The AppSync API key is emitted as a plaintext CloudFormation output, the Redis service is reachable from the public internet with only an optional password, the HTTPS server block in nginx is entirely commented out (meaning all WebSocket traffic is unencrypted), and the Docker Compose dev file hardcodes Neo4j credentials. On the reliability side, the stream-to-s3 Lambda has no Dead Letter Queue and its partial-failure behavior is incorrect — a single bad S3 upload causes the entire batch to be retried from DynamoDB including already-successful writes. The Glue alarm also watches the wrong CloudWatch metric. These are correctable issues on a solid foundation.

---

## Strengths

- PAY_PER_REQUEST billing on all three DynamoDB tables is correct for a spiky, event-driven workload.
- TTL (`expireAt`) is configured on the two high-volume tables (metrics, events), preventing unbounded growth.
- DynamoDB RemovalPolicy is RETAIN on all tables — data will not be destroyed on stack deletion.
- S3 lifecycle rule transitions raw data to Infrequent Access at 30 days and expires it at 365 days — good cost hygiene.
- Lambda runtime is Node 20 (current LTS), with minify enabled to reduce bundle size and cold start impact.
- Environment variable validation at module initialization (`if (!BUCKET) throw`) is a correct pattern for Lambda — fails fast on misconfiguration.
- The stream-to-s3 Lambda re-throws on error, correctly enabling DynamoDB stream retry.
- The Glue role is split from the Crawler role — correct least-privilege separation.
- The glue-trigger Lambda IAM policy is scoped to a single job ARN, not `*` — good.
- CloudWatch alarms cover both Lambda error counts and duration — the duration alarm at 80% of timeout (240s of 300s) is a well-chosen threshold.
- Multi-stage Dockerfile (deps → build → production) correctly separates build tooling from the runtime image.
- The production Docker Compose uses `depends_on: condition: service_healthy` — services will not start until their dependencies pass health checks.
- Memory limits are set on every container — appropriate for a constrained t3.small.
- The ec2-setup.sh UFW firewall configuration follows deny-by-default with explicit allow rules.
- The nginx config correctly handles WebSocket upgrade headers and disables buffering for Socket.IO.
- Rate limiting (`limit_req_zone`) is applied to the default HTTP location block.

---

## Critical Issues (must fix)

- [ ] **AppSync API key emitted in plaintext CloudFormation output**
  - File: `infra/cdk/lib/analytics-stack.ts`, line 417-420
  - The `AppSyncApiKey` CfnOutput writes the API key directly into CloudFormation stack outputs. Anyone with `cloudformation:DescribeStacks` or `cloudformation:GetTemplate` IAM access — including CI roles, developers, and any compromised credential — can read this key. It will also appear in CDK deploy terminal output in plaintext.
  - Fix: Do not output the API key via CfnOutput. Store it in AWS Secrets Manager during deployment and grant consumers `secretsmanager:GetSecretValue` instead.
  ```typescript
  // Remove this:
  new cdk.CfnOutput(this, 'AppSyncApiKey', {
    value: api.apiKey ?? '',
    description: 'AppSync API key',
  });

  // Add this:
  import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
  new secretsmanager.Secret(this, 'AppSyncApiKeySecret', {
    secretName: 'railtime/appsync-api-key',
    secretStringValue: cdk.SecretValue.unsafePlainText(api.apiKey ?? ''),
  });
  ```

- [ ] **Redis port 6379 is bound to 0.0.0.0 (publicly accessible)**
  - File: `infra/docker-compose.prod.yml`, line 38-39
  - The `ports: - "6379:6379"` binding exposes Redis directly on the EC2 public IP. The only protection is the optional `${REDIS_PASSWORD:-}` — note the `:-` default makes the password empty string if the env var is unset, meaning unauthenticated access is possible.
  - Fix: Remove the host port binding entirely. Nginx never proxies to Redis; only ws-server and the Redis adapter need access, and they communicate over the Docker internal network. The port binding is unnecessary and dangerous.
  ```yaml
  redis:
    image: redis:7-alpine
    # Remove: ports: - "6379:6379"
    # Redis is only accessed internally by ws-server via Docker network
  ```

- [ ] **Neo4j Bolt port 7687 is bound to 0.0.0.0 (publicly accessible)**
  - File: `infra/docker-compose.prod.yml`, line 7-9
  - Same issue as Redis. The Bolt port is exposed on the public EC2 IP, protected only by the `${NEO4J_PASSWORD}` value. If that credential is weak or leaked, the entire graph database is accessible from the internet.
  - Fix: Remove the host port binding. The ws-server connects to Neo4j over the internal Docker network (`bolt://neo4j:7687`), so the host binding provides no value in production.
  ```yaml
  neo4j:
    image: neo4j:5-community
    # Remove: ports: - "7687:7687"
    # Bolt is accessed internally only
  ```

- [ ] **HTTPS is not active — all traffic is plaintext HTTP**
  - File: `infra/nginx.conf`, lines 74-85
  - The entire HTTPS server block is commented out. The comment says "uncomment when SSL certs are available." This means Socket.IO connections, which carry real-time transit data and potentially user identifiers, are transmitted in plaintext. WebSocket traffic over `ws://` is trivially interceptable.
  - Fix: Obtain TLS certificates (Let's Encrypt via certbot is free) and activate the HTTPS block before any real user traffic. Add an HTTP-to-HTTPS redirect in the port-80 server block.
  ```nginx
  server {
      listen 80;
      server_name your-domain.com;
      return 301 https://$host$request_uri;
  }

  server {
      listen 443 ssl;
      ssl_certificate /etc/nginx/certs/fullchain.pem;
      ssl_certificate_key /etc/nginx/certs/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      ssl_ciphers HIGH:!aNULL:!MD5;
      # ... location blocks ...
  }
  ```

- [ ] **stream-to-s3 Lambda has no Dead Letter Queue and its partial-failure handling is incorrect**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 101-115; `infra/cdk/lambda/stream-to-s3/index.ts`, lines 59-88
  - Two issues compound each other. First, there is no DLQ configured on either `DynamoEventSource`, so if the Lambda exhausts its retries the records are silently dropped — no visibility into lost data. Second, when `Promise.all(uploads)` rejects (one S3 write fails), the Lambda throws and Lambda retries the entire batch from DynamoDB. But the other S3 upload already succeeded, so on retry it will write duplicate data for the successful type and retry the failed one. This creates data duplication in S3 that Glue will then double-count in rollups.
  - Fix: Add a DLQ and use `bisectBatchOnError` + `reportBatchItemFailures` to only retry failed records.
  ```typescript
  import * as sqs from 'aws-cdk-lib/aws-sqs';

  const streamDlq = new sqs.Queue(this, 'StreamToS3DLQ', {
    queueName: 'railtime-stream-to-s3-dlq',
    retentionPeriod: cdk.Duration.days(14),
  });

  streamToS3Fn.addEventSource(
    new lambdaEventSources.DynamoEventSource(metricsTable, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 100,
      maxBatchingWindow: cdk.Duration.minutes(5),
      bisectBatchOnError: true,
      onFailure: new lambdaEventSources.SqsDlq(streamDlq),
      retryAttempts: 3,
    }),
  );
  ```
  In the Lambda handler, write each type independently with separate try/catch rather than a single `Promise.all` that can cause cross-contamination:
  ```typescript
  for (const type of ['metrics', 'events'] as const) {
    if (grouped[type].length === 0) continue;
    try {
      await s3.send(new PutObjectCommand({ ... }));
    } catch (err) {
      console.error(`[stream-to-s3] Failed to write ${type}: ${err}`);
      throw err; // fail the whole invocation, let DynamoDB retry this type
    }
  }
  ```

---

## Important Improvements (should fix)

- [ ] **Glue job alarm watches the wrong CloudWatch metric**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 378-393
  - The `glue.driver.aggregate.numFailedTasks` metric measures Spark task failures (individual task-level failures within a job run). A Glue job can have failed tasks but still succeed overall. The correct metric for "the whole ETL job failed" is to use an EventBridge rule that fires on Glue job state `FAILED` or `ERROR`, or to use the `glue.driver.ExecutorRunTime` metric combined with a Glue job completion event. The current alarm will both miss job-level failures and potentially false-alarm on transient task retries.
  - Fix: Replace with an EventBridge rule targeting Glue job state change events:
  ```typescript
  new events.Rule(this, 'GlueJobFailureEvent', {
    eventPattern: {
      source: ['aws.glue'],
      detailType: ['Glue Job State Change'],
      detail: {
        jobName: ['railtime-daily-rollup'],
        state: ['FAILED', 'ERROR', 'TIMEOUT'],
      },
    },
    targets: [new targets.SnsTopic(alertTopic)],
  });
  ```

- [ ] **WsServerWriteRole uses AccountPrincipal — no service scoping**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 399-406
  - `new iam.AccountPrincipal(this.account)` allows any IAM principal in the AWS account to assume this role, including any developer's user or compromised CI credential. The intent is for the EC2 instance running the WS server to assume it, but `AccountPrincipal` is far too broad.
  - Fix: Use an EC2 service principal and attach the role to the instance profile. The comment in docker-compose.prod.yml ("AWS credentials provided via EC2 instance profile") confirms this is the intended mechanism — but it requires the role to trust EC2, not the entire account:
  ```typescript
  const wsServerRole = new iam.Role(this, 'WsServerWriteRole', {
    roleName: 'railtime-ws-server-dynamodb',
    assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
  });
  // Attach to an instance profile so EC2 can assume it
  const instanceProfile = new iam.InstanceProfile(this, 'WsServerInstanceProfile', {
    role: wsServerRole,
  });
  ```

- [ ] **RollupsTable grants write access to Glue but no TTL is configured**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 47-53
  - The rollups table has no TTL attribute. Rollup records are written once per route per day and grow indefinitely. At 30 routes × 365 days = ~10,950 items/year this is low-cost, but it is inconsistent with the pattern used for the other two tables and means historical rollup data can never be automatically pruned.
  - Fix: Add a TTL attribute (e.g., 2 years retention) and set it in the Glue script:
  ```typescript
  const rollupsTable = new dynamodb.Table(this, 'RollupsTable', {
    // ...
    timeToLiveAttribute: 'expireAt',
  });
  ```

- [ ] **S3 bucket has no server-side encryption configured**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 59-76
  - The analytics S3 bucket does not specify `encryption`. AWS S3 now encrypts at rest by default (SSE-S3) as of 2023, but this is not explicitly declared. The bucket also has no access logging configured, meaning there is no audit trail of who reads or writes to it.
  - Fix:
  ```typescript
  const analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
    // ...
    encryption: s3.BucketEncryption.S3_MANAGED, // explicit declaration
    serverAccessLogsPrefix: 'access-logs/',
    enforceSSL: true, // deny HTTP requests to the bucket
  });
  ```

- [ ] **Nginx nginx has no health check or restart policy for the nginx service**
  - File: `infra/docker-compose.prod.yml`, lines 103-118
  - The nginx container has no `healthcheck` defined. If nginx crashes or fails to start (e.g., bad cert paths), Docker will restart it (restart: unless-stopped) but there is no way to distinguish "restarting because healthy" from "restarting because broken" in `docker ps` or monitoring. The ws-server `depends_on: - ws-server` check also only waits for the container to start, not for nginx to be ready.
  - Fix:
  ```yaml
  nginx:
    healthcheck:
      test: ["CMD", "nginx", "-t"]
      interval: 30s
      timeout: 10s
      retries: 3
  ```

- [ ] **Dockerfile copies all node_modules from deps stage including devDependencies**
  - File: `server/Dockerfile`, lines 21-23
  - The production stage copies `node_modules` from the `deps` stage, which ran `npm ci` against the full `package.json` (including devDependencies like `tsx`, `pino-pretty`, `typescript`). This bloats the production image unnecessarily.
  - Fix: In the production stage, run `npm ci --omit=dev` to install only production dependencies, or use a `npm prune --production` step:
  ```dockerfile
  FROM node:20-alpine AS production
  WORKDIR /app
  COPY package.json package-lock.json* ./
  RUN npm ci --omit=dev
  COPY --from=build /app/dist ./dist
  ```

- [ ] **Dockerfile has no .dockerignore — the entire server directory is sent as build context**
  - File: `server/Dockerfile` (no .dockerignore found)
  - Without a `.dockerignore` file, `docker build ./server` sends the entire `server/` directory to the Docker daemon as build context. This includes the `dist/` output directory, `node_modules/` (if it exists locally), test files, and any `.env` files that may be present.
  - Fix: Create `server/.dockerignore`:
  ```
  node_modules/
  dist/
  .env*
  *.test.ts
  **/__tests__/
  .git/
  ```

- [ ] **CI pipeline has no caching for the Docker build job**
  - File: `.github/workflows/ci.yml`, lines 43-49
  - The `docker` job runs `docker build` with no layer caching. On every CI run, all three stages rebuild from scratch. This adds 2-3 minutes of unnecessary build time per push and wastes GitHub Actions minutes.
  - Fix: Add BuildKit cache:
  ```yaml
  - uses: docker/setup-buildx-action@v3
  - uses: docker/build-push-action@v5
    with:
      context: ./server
      push: false
      cache-from: type=gha
      cache-to: type=gha,mode=max
  ```

- [ ] **CI pipeline has no CDK synth or lint step for the CDK package**
  - File: `.github/workflows/ci.yml`
  - The CI pipeline validates the Next.js app (lint, typecheck, test), the WS server (typecheck, build), and the Docker image — but the CDK package in `infra/cdk/` has no CI validation at all. A broken stack would only be discovered at deploy time.
  - Fix: Add a CDK job:
  ```yaml
  cdk:
    name: CDK Stack
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra/cdk
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: infra/cdk/package-lock.json
      - run: npm ci
      - run: npm run build
      - run: npx cdk synth --quiet
        env:
          CDK_DEFAULT_ACCOUNT: '123456789012'
          CDK_DEFAULT_REGION: 'us-east-1'
  ```

- [ ] **AppSync API key expires after 365 days with no rotation mechanism**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 230-237
  - The API key has `expires: cdk.Expiration.after(cdk.Duration.days(365))`. When it expires, the API becomes unavailable. There is no alarm, no rotation, and no documented process for renewal. CDK will not automatically rotate it on redeploy — the expiry is relative to the first deployment.
  - Fix: Use AWS WAF + IAM authorization for API access instead of API keys for production use. If API keys must be used, add a CloudWatch alarm on the `4XXError` metric and document the rotation procedure:
  ```typescript
  // Alarm when the API key is near expiry (no native metric, use custom)
  // OR switch to Cognito/IAM authorization:
  authorizationConfig: {
    defaultAuthorization: {
      authorizationType: appsync.AuthorizationType.IAM,
    },
  },
  ```

---

## Minor Suggestions (nice to have)

- [ ] **ec2-setup.sh exposes port 3001 directly through the firewall**
  - File: `infra/ec2-setup.sh`, line 39
  - `ufw allow 3001/tcp` is noted as "for testing" but in a production environment this is a persistent security hole. Once nginx is configured with TLS, port 3001 should not be directly accessible.
  - Fix: Remove `ufw allow 3001/tcp` from the production firewall rules. Add a comment explaining it can be temporarily opened with `ufw allow 3001/tcp` during debugging.

- [ ] **glue-trigger Lambda has no source map enabled**
  - File: `infra/cdk/lib/analytics-stack.ts`, line 204
  - The `stream-to-s3` Lambda has `sourceMap: true` in its bundling config; the `glue-trigger` Lambda does not. This makes CloudWatch stack traces unreadable for the Glue trigger.
  - Fix:
  ```typescript
  bundling: {
    minify: true,
    sourceMap: true,
  },
  ```

- [ ] **Glue Crawler schedule runs 30 minutes before the ETL job**
  - File: `infra/cdk/lib/analytics-stack.ts`, line 186
  - The Crawler runs at `cron(30 0 * * ? *)` (00:30 UTC) and the ETL Glue job triggers at 01:00 UTC. The crawler updates the Glue Data Catalog schema for the `raw/` prefix. If the ETL job reads data using the catalog (via DynamicFrame), it benefits from an up-to-date schema — but the crawler only catalogues the previous day's partitions, not today's (since today's data is still being written). The timing is fine but could be made more explicit with a comment.

- [ ] **Glue job uses `maxCapacity: 2` (DPU) — consider using G.1X workers for cost predictability**
  - File: `infra/cdk/lib/analytics-stack.ts`, line 156
  - `maxCapacity` uses the older Glue job configuration model. Using `numberOfWorkers` + `workerType` (e.g., `G.1X`) is the preferred modern approach, gives better cost visibility (billed per worker-hour, not DPU-hour), and supports Glue 4.0 better.

- [ ] **Dev Docker Compose mounts the entire server source tree as a volume**
  - File: `docker-compose.v2.yml`, line 62
  - `- ./server:/app` mounts the entire host server directory into the container. Combined with `command: npx tsx watch src/index.ts`, this is correct for hot-reload development. But this also means the container runs as root by default (node:20-alpine base), and any write the container does to `/app` is reflected on the host. Low risk for dev, but worth noting.

- [ ] **Glue IAM role uses the broad `AWSGlueServiceRole` managed policy**
  - File: `infra/cdk/lib/analytics-stack.ts`, lines 138-142
  - `AWSGlueServiceRole` grants read access to all S3 buckets in the account (via S3:GetObject on `*`), access to CloudWatch Logs, and more. The `analyticsBucket.grantReadWrite(glueRole)` call adds specific bucket access on top of an already over-permissive policy. The managed policy is standard for Glue but the grant is redundant and the broad S3 read permission is unnecessary since Glue only needs the analytics bucket.
  - Fix: Use an inline policy instead of the managed policy for tighter control, or accept this as a known Glue operational necessity and document it.

- [ ] **`tsconfig.json` for the CDK package excludes the `lambda/` directory from compilation**
  - File: `infra/cdk/tsconfig.json`, lines 27-30
  - The `lambda/` directory is excluded from the CDK's own TypeScript compilation. This is intentional since `NodejsFunction` uses esbuild to bundle the Lambda code directly from source — but it means the Lambda TypeScript files are never typechecked by `tsc` in CI. Type errors in Lambda handlers will not be caught until the CDK deploy/bundle step.
  - Fix: Add a separate `tsconfig.lambda.json` that includes `lambda/**/*.ts` and add a typecheck step in the CDK CI job:
  ```bash
  npx tsc --project tsconfig.lambda.json --noEmit
  ```

- [ ] **vercel.json cron paths are not verified to exist**
  - File: `vercel.json`, lines 3-11
  - Two cron jobs reference `/api/cron/collect` and `/api/cron/cleanup`. If these route handler files are missing or throw on deployment, Vercel silently skips them. There is no CI check that these paths respond correctly.

---

## Architecture Considerations

### IAM Principal for the WS Server

The current `WsServerWriteRole` uses `AccountPrincipal` which is effectively an admin-level trust boundary. The correct pattern for EC2 workloads is to attach an IAM Instance Profile to the EC2 instance at launch time (via the AWS console or CDK EC2 construct). The WS server process then uses the EC2 metadata endpoint (`169.254.169.254`) to obtain short-lived credentials automatically — this is what the docker-compose.prod.yml comment correctly describes. The CDK stack should output the Instance Profile ARN, not just the role ARN, so it can be attached during EC2 provisioning.

### Data Integrity: Stream-to-S3 Idempotency

The `stream-to-s3` Lambda uses `randomUUID()` in the S3 key. This means each invocation writes a unique object — retries write additional objects rather than overwriting. This is intentional (no overwrite = no lost data on a failed write) but it means duplicate data will appear in S3 if the Lambda is retried. Glue's `daily-rollup.py` reads all files in the date partition and aggregates with Spark, so duplicates in the NDJSON files will inflate metrics (e.g., `trainCount` averages will be skewed). The correct fix is to use a deterministic key derived from the DynamoDB stream sequence number, or to deduplicate in the Glue job before aggregation.

### Single-EC2 Production Risk

The entire backend (Neo4j, Redis, Socket.IO) runs on a single t3.small instance with no replication, no standby, and no automatic failover. If this instance is terminated or its EBS volume fails, the service is down until manual intervention. For a hobbyist/demo project this is acceptable, but the operational docs (ec2-setup.sh, README) should make this clearly visible so the risk is understood. Consider snapshotting the EBS volume on a schedule (AWS Backup) to enable fast recovery.

### Nginx Rate Limiting Scope

The `limit_req_zone` rate limit (100 req/min per IP, burst 20) is only applied to `location /` — not to `location /socket.io/`. Socket.IO long-polling clients make repeated HTTP requests that could exhaust connections. Adding rate limiting to the socket.io location with a higher burst limit would be prudent.

### AppSync Subscription Security

The `publishRouteMetric` mutation is accessible to anyone with the API key, and it triggers the `onRouteMetricUpdate` subscription for all subscribers. A malicious client with the API key could spam fake metric data to all connected subscribers. Since the API key will be available to the front-end (it must be, for subscriptions to work), consider adding field-level authorization on the mutation to restrict who can publish vs. who can subscribe.

### Cost: Glue Pricing

At 2 DPU and Glue 4.0, a daily ETL job that processes a small analytics dataset is significantly overprovisioned. Glue bills a minimum of 1 minute per DPU-hour. At 2 DPU × (estimated) 5 minutes = ~$0.14/day = ~$51/year. For a dataset of this scale, a Lambda function or a simple Python script on the EC2 instance would cost pennies. This is worth revisiting once you know the actual daily data volume.

---

## Next Steps

1. Remove the Redis and Neo4j host port bindings from `docker-compose.prod.yml` (Critical — security).
2. Activate the HTTPS nginx server block and redirect port 80 to 443 (Critical — security).
3. Move the AppSync API key to Secrets Manager and remove the CfnOutput (Critical — security).
4. Fix the `WsServerWriteRole` trust policy from `AccountPrincipal` to `ServicePrincipal('ec2.amazonaws.com')` and create an Instance Profile (Critical — security).
5. Add a DLQ to both `DynamoEventSource` event sources and fix the parallel upload error handling in `stream-to-s3/index.ts` (Critical — reliability).
6. Replace the Glue job failure alarm with an EventBridge rule on Glue job state change events (Important — observability).
7. Fix the Dockerfile to install only production dependencies in the production stage (Important — image size).
8. Add `server/.dockerignore` to exclude `node_modules/`, `dist/`, and `.env*` from the build context (Important — security/performance).
9. Add CDK synth and Lambda typecheck steps to the CI pipeline (Important — reliability).
10. Add Lambda typecheck coverage for `infra/cdk/lambda/` via a separate `tsconfig.lambda.json` (Important — type safety).
