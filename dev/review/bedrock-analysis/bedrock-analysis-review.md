Last Updated: 2026-02-22

# bedrock-analysis — Code Review

## Executive Summary

The Bedrock transit analysis feature is a well-scoped, fire-and-forget analytics layer that sits cleanly on top of the existing metrics pipeline. The data flow is coherent: `flush()` → `generateAnalysis()` → Redis → HTTP GET → frontend card. Graceful degradation is correctly implemented at every layer. The majority of the code is production-ready.

That said, there are two correctness issues worth fixing before this goes under heavier load: a type-safety hole in `transit-analyzer.ts` that silently substitutes `0` for a missing `alertCount`, and a subtle bug in the frontend section parser (`parseAnalysisSections`) that can produce empty or incorrectly sliced content when the model returns multiple bold spans in a single bullet. There are also two moderate architectural concerns: the duplicated `CACHE_KEY` constant across two server files (a future-maintenance trap), and the 245-version skew between the Bedrock SDK and the DynamoDB SDK (currently harmless but will cause npm resolution divergence on the next DynamoDB patch).

The prompt engineering is strong for a first version — pre-computed signals reduce token waste and the negative instruction ("Do NOT restate raw numbers") correctly constrains the model. Minor improvements are possible around alert text truncation and the non-obvious `toMin()` formula.

---

## 1. Correctness

### C-1 — Type cast silently defaults `alertCount` to `0` [Medium]
**File:** `server/src/analytics/transit-analyzer.ts`, line 132

**Description:**
```typescript
alerts: (input.systemHealth as unknown as Record<string, unknown>).alertCount ?? 0,
```
`MetricRecord` declares `alertCount?: number | null`. The field is optional, so TypeScript won't let you access it directly through the typed interface — hence the double cast to bypass the type system. This works today, but the cast is fragile: if `MetricRecord` is refactored and `alertCount` is renamed or removed, this line silently returns `0` instead of surfacing a type error.

**Risk:** The AI prompt will always see `0 alerts` even when there are active alerts, unless the cast continues to resolve correctly.

**Fix:**
```typescript
// Option A — widen the interface (preferred):
// In transit-analyzer.ts, extend the AnalysisInput interface:
systemHealth: (MetricRecord & { alertCount?: number | null }) | null;

// Then access cleanly:
alerts: input.systemHealth?.alertCount ?? 0,

// Option B (minimal) — add alertCount to MetricRecord's visible fields
// by asserting via a dedicated SystemHealthRecord subtype.
```

---

### C-2 — `parseAnalysisSections` end-index calculation is incorrect [Medium]
**File:** `src/components/analytics/TransitAnalysisCard.tsx`, lines 82–85

**Description:**
```typescript
const endIndex = i < parts.length - 1
  ? text.lastIndexOf('**', parts[i + 1].startIndex - parts[i + 1].title.length - 4)
  : text.length;
```
The intent is to find the closing `**` of the current section header so content starts after it. However:
1. `parts[i].startIndex` already points to the character **after** the closing `**` of section `i` (the `exec` loop pushes `match.index + match[0].length`). The end of section `i` is simply `parts[i + 1].startIndex - parts[i+1].title.length - 4` — but `lastIndexOf` searches **backwards** from that position, so it can land on the opening `**` of section `i+1`'s title rather than a separator.
2. This is only triggered when the model returns actual `**Header**` section delimiters — the prompt explicitly says "Do NOT use section headers," so in practice the fallback single-section path is the common case. But the parser is advertised as the success path for structured responses, making the bug latent.

**Concrete failure case:** If the analysis text contains inline bold like `**A train** and **L train** both...` within a section, `sectionRegex` will match these as section titles, producing spurious zero-content sections.

**Fix:** The parser should be redesigned to match the actual model output format. Since the prompt instructs the model to write bullet points (not section headers), either:
- Remove `parseAnalysisSections` entirely and render the raw markdown bullet list (simpler).
- Change the prompt to explicitly request a fenced format the parser can reliably split on (e.g., a custom delimiter like `---`).
- If bold headers are desired, fix the end-index to `parts[i + 1].startIndex - (parts[i + 1].title.length + 4)` and track whether bold spans are section delimiters vs. inline emphasis (requires a more robust regex).

---

### C-3 — `generateAnalysis` called inside `try` block that has already cleared buffers [Low / Info]
**File:** `server/src/analytics/metrics-collector.ts`, lines 749–758

**Description:**
`generateAnalysis()` is called after `await Promise.all([writeMetrics, writeEvents, writeRollups])`. If `writeMetrics` throws (DynamoDB batch failure after MAX_RETRIES), the catch block runs and `generateAnalysis` is **not called** — which is the correct behavior. This is fine. Documenting here because the original pre-identified concern was incorrect (it is only called after a successful flush, not on empty buffers).

No action needed.

---

### C-4 — 202 response body has `model: "pending"` — frontend treats it as real data [Low]
**File:** `server/src/api/transit-analysis.ts`, lines 40–44 / `src/components/analytics/TransitAnalysisCard.tsx`, lines 184–190

**Description:**
When Redis has no cached result, the endpoint returns HTTP 202 with:
```json
{ "analysis": "Transit analysis is being generated...", "model": "pending" }
```
The frontend checks `res.ok` (202 is `ok`), deserializes the body into `TransitAnalysisResponse`, stores it in `cachedResult`, and renders it — including displaying `"pending"` as the model name in the `<Badge>`. The user sees a badge saying "Powered by pending".

Additionally, this `202` response is then stored in the module-level cache with a 10-minute TTL. If the server generates a real analysis 30 seconds later, the client will not fetch it for another ~10 minutes.

**Fix:**
```typescript
// Option A — distinguish pending from real data at the type level:
// Return 202 with a dedicated shape: { status: 'generating' }
// Frontend checks for status === 'generating' before caching.

// Option B — return 503 for pending (client will hit error path, not cache path):
sendJson(res, 503, { error: 'Analysis not yet available' });
// Frontend already handles error state without caching.

// Option C — minimal: exclude 202 responses from the module-level cache:
if (res.status !== 202) {
  cachedResult = json;
  cacheTimestamp = Date.now();
}
```

---

## 2. Security

### S-1 — No authentication on `/api/transit-analysis` [Medium]
**File:** `server/src/index.ts`, lines 50–53 / `server/src/api/transit-analysis.ts`

**Description:**
The endpoint is publicly accessible to anyone who knows the WS server URL. It returns AI-generated text derived from internal metrics — route names, delay numbers, anomaly descriptions. This is low-sensitivity data, but:
1. The endpoint can be polled at high frequency at zero cost to the caller (Redis reads are cheap).
2. In production the WS server is on EC2 behind a public port. The Bedrock call costs money; the endpoint itself does not, but serving it without rate limiting is a small operational risk.

**Fix:** Since the frontend already enforces CORS by origin, the existing `allowedOrigins` check provides the main protection for browser callers. For defense-in-depth, consider adding a simple shared secret header check using `INTERNAL_API_SECRET` env var, consistent with how other internal endpoints are protected in the project. At minimum, document the intentional decision to leave this open.

---

### S-2 — Alert text included verbatim in the LLM prompt [Low / Info]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 136–139

**Description:**
```typescript
const alerts = input.alerts.map(a => ({
  routes: a.affectedRoutes.join(', '),
  text: a.headerText.slice(0, 150),
}));
```
MTA alert text is truncated to 150 characters and JSON-serialized into the prompt. This is safe for a transit data use case since MTA controls alert content, but it is worth noting as a data injection surface if the alert source ever changes (e.g., user-submitted alerts in a future feature). The `slice(0, 150)` is an appropriate safeguard.

No immediate action required. Flag for reassessment if alert sources become user-controlled.

---

### S-3 — AWS credentials via EC2 instance profile — correct, no hardcoding [Info]
**File:** `infra/docker-compose.prod.yml`, line 81 / `server/src/analytics/transit-analyzer.ts`, lines 22–27

**Description:**
Credentials are intentionally provided via EC2 instance profile (IAM role). The Bedrock client is initialized with only `region`, correctly allowing the SDK to fall back to the metadata service. No keys are hardcoded. This is the correct pattern.

No action needed.

---

## 3. Architecture

### A-1 — `CACHE_KEY` duplicated across two server files [Medium]
**File:** `server/src/analytics/transit-analyzer.ts`, line 16 / `server/src/api/transit-analysis.ts`, line 13

**Description:**
```typescript
// transit-analyzer.ts:16
const CACHE_KEY = 'transit-analysis:latest';

// transit-analysis.ts:13
const CACHE_KEY = 'transit-analysis:latest';
```
The string literal is duplicated. If one is changed and the other is not, the analyzer will write to a key the API never reads. This is a classic silent failure mode: no TypeScript error, no runtime error, just stale data.

**Fix:**
```typescript
// server/src/lib/cache-keys.ts (new file, ~5 lines):
export const CACHE_KEYS = {
  TRANSIT_ANALYSIS: 'transit-analysis:latest',
} as const;

// Both files import from this module:
import { CACHE_KEYS } from '../lib/cache-keys.js';
```

---

### A-2 — Alert type defined inline in both `transit-analyzer.ts` and `metrics-collector.ts` [Medium]
**File:** `server/src/analytics/transit-analyzer.ts`, line 34 / `server/src/analytics/metrics-collector.ts`, line 91

**Description:**
```typescript
// transit-analyzer.ts:34 (inside AnalysisInput)
alerts: Array<{ id: string; headerText: string; affectedRoutes: string[] }>;

// metrics-collector.ts:91 (module-level variable)
let latestAlertDetails: Array<{ id: string; headerText: string; affectedRoutes: string[] }> = [];
```
These are structurally identical inline types derived from `ServiceAlert`. They are a subset — not an alias — of `ServiceAlert`, which makes extraction meaningful: the subset is the intentional projection used by the analytics pipeline.

**Fix:**
```typescript
// In server/src/types.ts (already shared) or server/src/analytics/types.ts:
export interface AlertSummary {
  id: string;
  headerText: string;
  affectedRoutes: string[];
}
```
Use `AlertSummary` in both files. This also makes future expansion (adding `severity` to the analysis input) a one-line change.

---

### A-3 — `TransitAnalysisCard` uses direct `fetch` instead of `apiClient` [Medium]
**File:** `src/components/analytics/TransitAnalysisCard.tsx`, line 180

**Description:**
```typescript
const res = await fetch(`${wsUrl}/api/transit-analysis`);
```
The project pattern for all API calls from the frontend is `apiClient` (wrapping fetch with consistent error handling, base URL resolution, and auth headers) plus TanStack Query hooks. This component bypasses both layers with a raw `fetch` and a module-level custom cache.

**Rationale assessment:** The module-level cache is solving a real problem (tab-switch remount flicker that the existing commit log confirms was an active issue). However, the correct solution within project patterns is a TanStack Query hook with `staleTime: CACHE_MAX_AGE_MS` — this provides the same remount stability without leaving the established fetching contract.

**Fix:**
```typescript
// src/hooks/use-transit-analysis.ts
export function useTransitAnalysis() {
  return useQuery({
    queryKey: queryKeys.transitAnalysis(),
    queryFn: () => apiClient.get<TransitAnalysisResponse>('/api/transit-analysis'),
    staleTime: 10 * 60 * 1000,   // 10 min — matches server TTL
    gcTime: 15 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}
```
The module-level `cachedResult` / `cacheTimestamp` variables and the manual `useEffect` interval can then be removed from `TransitAnalysisCard`.

---

### A-4 — `TransitAnalysisCard` is placed in the `Ridership & Impact` tab [Low / Info]
**File:** `src/app/(dashboard)/analytics/page.tsx`, line 211

**Description:**
The card is rendered inside the `ridership` tab (`TabsContent value="ridership"`). Semantically, AI transit analysis is system-wide intelligence, not specific to ridership. The `overview` tab already hosts `LiveSystemDashboard`, `AlertStatusCard`, `SystemHealthTimeline`, and `BestWorstRouteCard` — a more natural home.

This is a UX judgment call, not a bug. Noting it for product discussion.

---

## 4. Performance

### P-1 — `buildPrompt` serializes full route arrays as JSON blobs [Low]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 148, 150

**Description:**
```typescript
## Per-Route (5-min window, times in minutes)
${JSON.stringify(routeData)}

## Daily Totals
${JSON.stringify(rollupSummary)}
```
`routeData` can be up to ~80 objects (NYC has ~28 routes × 2 directions). `rollupSummary` mirrors this. A full flush with all routes produces ~6–8KB of JSON inline in the prompt. At 1,024 max output tokens and a ~4KB prompt, this is well within the `claude-sonnet-4` context window. No performance issue today.

However, if routes are ever deduplicated or the schema grows (e.g., adding per-stop data), this could balloon. Consider filtering to routes with `trains > 0` before serializing:

```typescript
const routeData = input.metrics
  .filter(m => m.routeId !== 'SYSTEM_HEALTH' && m.trainCount > 0)  // add trainCount filter
  .map(...)
```

This reduces the JSON payload by ~40% during off-peak hours (many routes have 0 trains).

---

### P-2 — Bedrock client singleton is initialized at first call, not at startup [Low / Info]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 19–28

**Description:**
```typescript
let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: ... });
  }
  return bedrockClient;
}
```
The lazy singleton means the first Bedrock call (~5 minutes after server start) bears the SDK initialization cost. This is minor (< 100ms) but could be eliminated by initializing the client at module load time, consistent with how `getDynamoClient()` and `getRedisClient()` work elsewhere in the server.

No action required — documenting for awareness.

---

## 5. Reliability

### R-1 — `generateAnalysis` is called even when `metrics` contains only `SYSTEM_HEALTH` [Medium]
**File:** `server/src/analytics/metrics-collector.ts`, line 750 / `server/src/analytics/transit-analyzer.ts`, line 52

**Description:**
The `metrics` array passed to `generateAnalysis` always includes the synthetic `SYSTEM_HEALTH` record appended at line 647 of `metrics-collector.ts`. If for some reason the `buffers` map had entries but all per-route `trainCount` values were 0 (e.g., all feeds erroring simultaneously), `routeData` after the `.filter(m => m.routeId !== 'SYSTEM_HEALTH')` call would be an empty array. The prompt would still be sent to Bedrock with empty route and rollup sections, wasting ~$0.003 per call and generating a useless or confusing analysis.

**Fix:**
```typescript
// In metrics-collector.ts, before calling generateAnalysis:
const routeMetrics = metrics.filter(m => m.routeId !== 'SYSTEM_HEALTH');
if (routeMetrics.length === 0 || routeMetrics.every(m => m.trainCount === 0)) {
  console.log('[metrics-collector] Skipping analysis — no active trains');
} else {
  generateAnalysis({ metrics, rollups, events: delayEvents, alerts: latestAlertDetails, systemHealth: healthRecord })
    .catch(...);
}
```

---

### R-2 — No rate limiting or deduplication guard on Bedrock calls [Medium]
**File:** `server/src/analytics/transit-analyzer.ts`, `server/src/analytics/metrics-collector.ts`

**Description:**
The flush interval is 5 minutes. On a server restart, the first flush fires within 5 minutes. If the server crashes mid-Bedrock-call and restarts, a second call is made at the next flush. There is no check like "is there already a recent result in Redis before spending money on a new call?"

Currently `generateAnalysis` always calls Bedrock regardless of whether a valid cached result exists. During normal operation this is fine (TTL is 10 min, flush is 5 min — so you get a fresh result every 5 min, overwriting the still-valid 5-min-old one unnecessarily).

**Fix (minimal):**
```typescript
// In generateAnalysis, before building the prompt:
const existing = await getCache<AnalysisResult>(CACHE_KEY);
const ageMs = existing
  ? Date.now() - new Date(existing.generatedAt).getTime()
  : Infinity;
if (ageMs < 4 * 60 * 1000) { // skip if result is < 4 min old
  console.log('[transit-analyzer] Skipping — fresh result in cache');
  return;
}
```

---

### R-3 — Frontend silently shows stale data without age warning [Low]
**File:** `src/components/analytics/TransitAnalysisCard.tsx`, lines 284–288

**Description:**
The footer shows "Last updated X min ago". If the WS server is down and the module-level cache holds a 9-minute-old result, the user sees valid-looking content that may be significantly stale. There is no visual indicator distinguishing "fresh" from "stale."

**Fix:** Add a visual indicator (e.g., yellow tint, "Stale" badge) when `relativeTime` exceeds 6 minutes:
```typescript
const isStale = Date.now() - new Date(data.generatedAt).getTime() > 6 * 60 * 1000;
// Conditionally render: <Badge variant="outline" className="text-yellow-500">Stale</Badge>
```

---

## 6. Code Quality

### Q-1 — `toMin()` formula is non-obvious [Low]
**File:** `server/src/analytics/transit-analyzer.ts`, line 46

**Description:**
```typescript
return Math.round(seconds / 6) / 10; // 1 decimal place
```
`Math.round(s / 6) / 10` is algebraically equivalent to `Math.round(s / 60 * 10) / 10` but the intermediate value has no intuitive meaning. The comment "1 decimal place" explains the result but not the algebra.

**Fix:**
```typescript
function toMin(seconds: number | null | undefined): number | null {
  if (seconds == null) return null;
  return Math.round((seconds / 60) * 10) / 10; // convert s → min, 1 decimal place
}
```

---

### Q-2 — `TransitAnalysisResponse` type is duplicated between server and client [Low]
**File:** `server/src/analytics/transit-analyzer.ts` (`AnalysisResult`) / `src/components/analytics/TransitAnalysisCard.tsx` (`TransitAnalysisResponse`)

**Description:**
These two interfaces are structurally identical:
```typescript
// server — AnalysisResult
interface AnalysisResult { analysis: string; generatedAt: string; model: string; }

// client — TransitAnalysisResponse
interface TransitAnalysisResponse { analysis: string; generatedAt: string; model: string; }
```
This is a consequence of the two-package architecture (server cannot import from Next.js app). Per `server/src/types.ts` header comment, this is a known limitation: "Replicated from src/types/mta.ts because the server is a separate package."

The correct long-term fix is a shared `packages/types` workspace package. For now, add a comment to both interfaces cross-referencing the other, to prevent unilateral evolution:
```typescript
// Keep in sync with src/components/analytics/TransitAnalysisCard.tsx:TransitAnalysisResponse
export interface AnalysisResult { ... }
```

---

### Q-3 — `key` prop on section map uses array index [Low]
**File:** `src/components/analytics/TransitAnalysisCard.tsx`, line 272

**Description:**
```typescript
{sections.map((section, i) => (
  <div key={i} className="space-y-1.5">
```
Using array index as `key` causes React to reuse DOM nodes when sections are re-ordered or re-counted between renders. Since section count can change between fetch cycles (model generates different numbers of bullet points), this can cause stale content to flash. Use `section.title` as the key:

```typescript
{sections.map((section) => (
  <div key={section.title} className="space-y-1.5">
```
Note: if the model ever returns duplicate bold titles, `section.title` would also be non-unique. The safest key is `section.title + '_' + i` as a fallback, but in practice model output is unlikely to have duplicate section headers.

---

### Q-4 — `getBedrockClient()` does not guard against `AWS_REGION` being absent [Low]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 21–28

**Description:**
`getDynamoClient()` (the pattern used elsewhere) returns `null` when `AWS_REGION` is not set, allowing callers to short-circuit. `getBedrockClient()` always returns a client — if `AWS_REGION` is absent, the SDK will attempt credential and region resolution via other means (environment chain), potentially succeeding in dev with local AWS config or failing with an unhelpful SDK error.

There is no top-level guard like `if (!getDynamoClient()) return;` in `generateAnalysis`. The catch block handles it, but the logged error is an SDK auth/region error rather than a clear "Bedrock not configured" message.

**Fix:** Mirror the DynamoDB pattern:
```typescript
// Check AWS_REGION before initializing:
function getBedrockClient(): BedrockRuntimeClient | null {
  if (!process.env.AWS_REGION) return null;
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  }
  return bedrockClient;
}

// In generateAnalysis:
const client = getBedrockClient();
if (!client) {
  console.log('[transit-analyzer] AWS_REGION not set — skipping analysis');
  return;
}
```

---

### Q-5 — AWS SDK version skew [Medium]
**File:** `server/package.json`, lines 16–18

**Description:**
```json
"@aws-sdk/client-bedrock-runtime": "^3.995.0",
"@aws-sdk/client-dynamodb": "^3.750.0",
"@aws-sdk/lib-dynamodb": "^3.750.0"
```
The AWS SDK v3 packages within the `@aws-sdk` namespace are versioned in lockstep; all `@aws-sdk/*` packages in a project should be at the same minor version. The 245-version gap (3.995 vs 3.750) means npm may install two versions of shared `@aws-sdk/middleware-*` and `@smithy/*` packages, increasing bundle size and potentially causing subtle type incompatibilities if smithy middleware interfaces diverged between those releases.

**Fix:** Align all three to the same version:
```json
"@aws-sdk/client-bedrock-runtime": "^3.995.0",
"@aws-sdk/client-dynamodb": "^3.995.0",
"@aws-sdk/lib-dynamodb": "^3.995.0"
```
This bumps the DynamoDB packages, which is safe — AWS SDK v3 follows semantic versioning strictly for breaking changes.

---

## 7. Prompt Engineering

### PE-1 — Prompt explicitly forbids section headers but `parseAnalysisSections` expects them [High]
**File:** `server/src/analytics/transit-analyzer.ts`, line 170 / `src/components/analytics/TransitAnalysisCard.tsx`, lines 60–93

**Description:**
The prompt ends with:
```
Do NOT restate raw numbers, list best/worst routes, give generic rider advice, or use section headers.
```
Yet `parseAnalysisSections` is designed to split on `**Section Name**` headers. This is a fundamental contract mismatch: the server tells the model not to produce headers, but the client expects them to structure the output.

In practice, Claude tends to use bold text for emphasis within bullet points (e.g., **A train** bunching cascades...) which the parser incorrectly treats as section delimiters. The result is that the single-section fallback fires on every real response, rendering all content under one "Analysis" heading with a `Brain` icon.

This is both a correctness issue (C-2) and a prompt engineering issue. They must be fixed together.

**Fix options (pick one):**
1. **Remove the parser, render markdown.** Install `react-markdown` or a lightweight alternative and render the bullet list directly. Simplest path — the model output is already well-formatted markdown.
2. **Change the prompt to produce a parseable format.** Replace the "no headers" instruction with a structured format request:
   ```
   Respond with exactly 3-5 bullet points. Each bullet must start with "- " followed by the insight.
   Do not use bold text for anything except route names (e.g., **A**, **7**).
   ```
   Then parse by splitting on `\n- `.
3. **Align prompt and parser.** Remove the "no section headers" constraint, explicitly request `**Section Name**` headers, and fix the parser's end-index calculation.

---

### PE-2 — Anomaly `detail` field falls back to delay in minutes [Low / Info]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 91–95

**Description:**
```typescript
.map(e => ({
  type: e.pk.split('#')[0],
  route: e.pk.split('#').slice(1).join('#'),
  detail: e.description ?? `${toMin(e.delaySeconds ?? 0)} min delay`,
}));
```
For `BUNCH#` and `GAP#` events, `e.description` is set (e.g., `"3 bunching instances detected"`). For `DELAY#` events, `description` is not set — only `delaySeconds` is. The fallback is correct for delay events. However, `e.delaySeconds ?? 0` means a delay event with no seconds recorded becomes `"0 min delay"` rather than `"unknown delay"`. This introduces a misleading `0 min` data point into the prompt.

**Fix:**
```typescript
detail: e.description ?? (e.delaySeconds != null ? `${toMin(e.delaySeconds)} min delay` : 'delay recorded'),
```

---

### PE-3 — `toMin()` passes `null` through to the prompt as JSON `null` [Low]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 57–65

**Description:**
When `avgDelaySeconds` is `null` (no delay data for a route), `toMin()` returns `null`. This null flows into the serialized JSON prompt:
```json
{"route":"G","dir":"N","trains":4,"delayMin":null,"onTime":null,"headwayMin":180,...}
```
JSON `null` values add no analytical value and consume tokens. Routes with null delay data are routes without schedule deviation measurements — the model has nothing meaningful to say about their delay, and the nulls may confuse it into speculating.

**Fix:** Filter `null` fields before serialization, or replace them with a sentinel string:
```typescript
const routeData = input.metrics
  .filter(m => m.routeId !== 'SYSTEM_HEALTH')
  .map(m => {
    const entry: Record<string, unknown> = { route, dir, trains: m.trainCount };
    const delayMin = toMin(m.avgDelaySeconds);
    if (delayMin != null) entry.delayMin = delayMin;
    // ... similarly for other nullable fields
    return entry;
  });
```

---

### PE-4 — No temperature / top-p settings — relying on Bedrock defaults [Low / Info]
**File:** `server/src/analytics/transit-analyzer.ts`, lines 186–193

**Description:**
The `InvokeModelCommand` body sets `max_tokens: 1024` but does not specify `temperature` or `top_p`. Bedrock defaults (temperature ~1.0 for claude-sonnet-4) mean the model will be more creative/variable. For a transit analytics use case where factual consistency across calls is desirable, `temperature: 0.3` or `temperature: 0` would produce more stable, reproducible insights.

**Fix:**
```typescript
body: JSON.stringify({
  anthropic_version: 'bedrock-2023-05-31',
  max_tokens: 1024,
  temperature: 0.3,  // reproducible, factual analysis
  messages: [{ role: 'user', content: prompt }],
}),
```
