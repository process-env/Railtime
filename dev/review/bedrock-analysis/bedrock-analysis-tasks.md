Last Updated: 2026-02-22

# bedrock-analysis — Actionable Task Checklist

Tasks are ordered by priority. Each entry includes severity, effort estimate (S = < 1 hour, M = 1–4 hours, L = 4+ hours), and file(s) affected.

---

## Priority 1 — Must Fix

### TASK-1: Fix prompt/parser contract mismatch
**Severity:** High | **Effort:** M | **Finding:** PE-1 + C-2

The prompt tells the model "Do NOT use section headers", but `parseAnalysisSections` expects `**Header**` delimiters to split content into sections. In practice every response goes through the single-section fallback. Additionally, inline bold text (e.g., `**A train**`) is incorrectly treated as a section delimiter.

**Files affected:**
- `server/src/analytics/transit-analyzer.ts` (line 163–170 — prompt Task section)
- `src/components/analytics/TransitAnalysisCard.tsx` (lines 60–93 — `parseAnalysisSections`)

**Recommended approach (lowest effort):** Remove `parseAnalysisSections` entirely and render the raw bullet-point markdown directly. Replace `sections.map(...)` in the render with a single `<ReactMarkdown>` or equivalent. This eliminates the parser and aligns with the prompt's actual output format.

**Alternative approach:** Change the prompt to explicitly request `**Section: Content**` format, then fix the end-index calculation in `parseAnalysisSections` to use `parts[i + 1].startIndex - (parts[i + 1].title.length + 4)` and validate that only lines starting with `**` are treated as section headers (not inline bold).

---

### TASK-2: Fix 202 "pending" response being cached on the client
**Severity:** High | **Effort:** S | **Finding:** C-4

When the server returns HTTP 202 (no cached analysis yet), the frontend stores the placeholder response in the module-level cache. This blocks the real analysis from appearing for up to 10 minutes.

**Files affected:**
- `src/components/analytics/TransitAnalysisCard.tsx` (lines 184–190 — fetch block)

**Fix:**
```typescript
const json: TransitAnalysisResponse = await res.json();

// Only cache real responses, not pending placeholders
if (res.status === 200) {
  cachedResult = json;
  cacheTimestamp = Date.now();
}

setData(json);
setError(null);
```
Alternatively, change the server to return 503 for "not yet available" so it hits the `!res.ok` branch and is never cached.

---

### TASK-3: Align AWS SDK versions
**Severity:** Medium | **Effort:** S | **Finding:** Q-5

`@aws-sdk/client-bedrock-runtime` is at `^3.995.0` while `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` are at `^3.750.0`. The 245-version gap causes npm to potentially resolve two copies of shared `@smithy/*` middleware.

**Files affected:**
- `server/package.json`

**Fix:**
```json
"@aws-sdk/client-bedrock-runtime": "^3.995.0",
"@aws-sdk/client-dynamodb": "^3.995.0",
"@aws-sdk/lib-dynamodb": "^3.995.0"
```
After updating, run `npm install` in the `server/` directory and verify DynamoDB writes still work in a dev environment.

---

## Priority 2 — Should Fix

### TASK-4: Extract shared `CACHE_KEY` constant
**Severity:** Medium | **Effort:** S | **Finding:** A-1

`'transit-analysis:latest'` is duplicated in two server files. A rename in one file without the other would silently break the feature.

**Files affected:**
- `server/src/analytics/transit-analyzer.ts` (line 16)
- `server/src/api/transit-analysis.ts` (line 13)

**Fix:** Create `server/src/lib/cache-keys.ts`:
```typescript
export const CACHE_KEYS = {
  TRANSIT_ANALYSIS: 'transit-analysis:latest',
} as const;
```
Import and use `CACHE_KEYS.TRANSIT_ANALYSIS` in both files.

---

### TASK-5: Extract shared `AlertSummary` type
**Severity:** Medium | **Effort:** S | **Finding:** A-2

`Array<{ id: string; headerText: string; affectedRoutes: string[] }>` is defined identically in both `transit-analyzer.ts` and `metrics-collector.ts`.

**Files affected:**
- `server/src/analytics/transit-analyzer.ts` (line 34)
- `server/src/analytics/metrics-collector.ts` (line 91)

**Fix:** Add to `server/src/types.ts`:
```typescript
export interface AlertSummary {
  id: string;
  headerText: string;
  affectedRoutes: string[];
}
```
Update both files to import and use `AlertSummary`.

---

### TASK-6: Fix `alertCount` type-cast in `buildPrompt`
**Severity:** Medium | **Effort:** S | **Finding:** C-1

`(input.systemHealth as unknown as Record<string, unknown>).alertCount ?? 0` bypasses TypeScript to access an optional field. If the field is renamed or removed, this silently returns `0`.

**Files affected:**
- `server/src/analytics/transit-analyzer.ts` (line 132)
- `server/src/analytics/transit-analyzer.ts` (AnalysisInput interface, line 35)

**Fix:** Widen the `systemHealth` type in `AnalysisInput`:
```typescript
import type { MetricRecord } from './dynamodb-writer.js';

type SystemHealthRecord = MetricRecord & { alertCount?: number | null };

export interface AnalysisInput {
  metrics: MetricRecord[];
  rollups: RollupRecord[];
  events: EventRecord[];
  alerts: AlertSummary[];  // after TASK-5
  systemHealth: SystemHealthRecord | null;
}
```
Then access: `input.systemHealth?.alertCount ?? 0`

---

### TASK-7: Skip Bedrock call when no active trains or metrics are empty
**Severity:** Medium | **Effort:** S | **Finding:** R-1

`generateAnalysis` is called even when all routes have `trainCount === 0` (e.g., late night or total feed failure). This produces an analysis on empty data and wastes a Bedrock call.

**Files affected:**
- `server/src/analytics/metrics-collector.ts` (lines 749–758)

**Fix:**
```typescript
const routeMetrics = metrics.filter(m => m.routeId !== 'SYSTEM_HEALTH');
if (routeMetrics.length > 0 && routeMetrics.some(m => m.trainCount > 0)) {
  generateAnalysis({
    metrics,
    rollups,
    events: delayEvents,
    alerts: latestAlertDetails,
    systemHealth: healthRecord,
  }).catch(err =>
    console.error('[metrics-collector] Transit analysis generation failed:', err instanceof Error ? err.message : err),
  );
} else {
  console.log('[metrics-collector] Skipping analysis — no active trains');
}
```

---

### TASK-8: Replace raw `fetch` with TanStack Query hook
**Severity:** Medium | **Effort:** M | **Finding:** A-3

`TransitAnalysisCard` uses a raw `fetch()` with a module-level cache and manual `setInterval`, departing from the project's established pattern of `apiClient` + `useQuery`.

**Files affected:**
- `src/components/analytics/TransitAnalysisCard.tsx`
- `src/hooks/` (new file: `use-transit-analysis.ts`)
- `src/lib/api/query-keys.ts` (add `transitAnalysis` key)

**Fix:** Create `src/hooks/use-transit-analysis.ts`:
```typescript
export function useTransitAnalysis() {
  return useQuery({
    queryKey: queryKeys.transitAnalysis(),
    queryFn: () => apiClient.get<TransitAnalysisResponse>('/api/transit-analysis'),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}
```
Remove `cachedResult`, `cacheTimestamp`, `CACHE_MAX_AGE_MS`, `getCachedResult`, `fetchAnalysis`, `useEffect`, `useCallback`, and `intervalRef` from `TransitAnalysisCard`. TanStack Query's `gcTime` provides equivalent remount stability.

Note: the `apiClient` base URL must include the WS server URL for transit analysis calls (different origin from the Next.js API routes). Either configure a separate client instance or call the endpoint differently — check `src/lib/api/` for how the WS server URL is currently used in other hooks.

---

### TASK-9: Add `temperature: 0.3` to Bedrock invocation
**Severity:** Low (but high value) | **Effort:** S | **Finding:** PE-4

Without an explicit temperature setting, Bedrock defaults to ~1.0, producing variable and sometimes overly creative output. For factual transit analysis, lower temperature improves consistency.

**Files affected:**
- `server/src/analytics/transit-analyzer.ts` (line 188)

**Fix:**
```typescript
body: JSON.stringify({
  anthropic_version: 'bedrock-2023-05-31',
  max_tokens: 1024,
  temperature: 0.3,
  messages: [{ role: 'user', content: prompt }],
}),
```

---

### TASK-10: Add Bedrock permission to IAM role
**Severity:** Medium | **Effort:** S | **Finding:** S-1 (implicit)

The EC2 instance profile role (`railtime-ec2-dynamodb`) has DynamoDB permissions but Bedrock permissions must be explicitly added. Without this, `generateAnalysis` will fail with an `AccessDeniedException` in production (caught silently by the catch block, meaning the feature appears to work but never generates analysis).

**Files affected:**
- IAM policy attached to the EC2 instance profile (AWS console or CDK)

**Fix:** Add to the IAM policy:
```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel"
  ],
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0"
}
```
Verify in production by checking CloudWatch logs for `[transit-analyzer] Analysis generated and cached`.

---

## Priority 3 — Nice to Have

### TASK-11: Make `toMin()` formula readable
**Severity:** Low | **Effort:** S | **Finding:** Q-1

**Files affected:** `server/src/analytics/transit-analyzer.ts` (line 46)

```typescript
// Before
return Math.round(seconds / 6) / 10;
// After
return Math.round((seconds / 60) * 10) / 10; // convert s → min, 1 decimal place
```

---

### TASK-12: Add staleness indicator to `TransitAnalysisCard`
**Severity:** Low | **Effort:** S | **Finding:** R-3

**Files affected:** `src/components/analytics/TransitAnalysisCard.tsx` (footer, lines 284–288)

When cached data is older than 6 minutes, show a visual indicator:
```typescript
const ageMs = Date.now() - new Date(data.generatedAt).getTime();
const isStale = ageMs > 6 * 60 * 1000;
// Conditionally render a "Stale" badge in the footer
```

---

### TASK-13: Fix `key` prop on sections map
**Severity:** Low | **Effort:** S | **Finding:** Q-3

**Files affected:** `src/components/analytics/TransitAnalysisCard.tsx` (line 272)

```typescript
// Before
{sections.map((section, i) => <div key={i} ...>
// After
{sections.map((section) => <div key={section.title} ...>
```

---

### TASK-14: Add skip-if-fresh guard in `generateAnalysis`
**Severity:** Low | **Effort:** S | **Finding:** R-2

Check Redis before calling Bedrock. If the cached result is less than 4 minutes old, skip the call.

**Files affected:** `server/src/analytics/transit-analyzer.ts` (inside `generateAnalysis`, before line 180)

```typescript
const existing = await getCache<AnalysisResult>(CACHE_KEY);
if (existing) {
  const ageMs = Date.now() - new Date(existing.generatedAt).getTime();
  if (ageMs < 4 * 60 * 1000) {
    console.log('[transit-analyzer] Skipping — result is fresh');
    return;
  }
}
```

---

### TASK-15: Filter null fields from prompt JSON
**Severity:** Low | **Effort:** S | **Finding:** PE-3

Routes with `delayMin: null` and `onTime: null` add tokens without analytical value.

**Files affected:** `server/src/analytics/transit-analyzer.ts` (lines 52–66)

Omit null fields from the route data objects before serializing into the prompt.

---

### TASK-16: Add cross-reference comments to duplicated `AnalysisResult` / `TransitAnalysisResponse` types
**Severity:** Low | **Effort:** S | **Finding:** Q-2

Until a shared types package exists, add "keep in sync with" comments.

**Files affected:**
- `server/src/analytics/transit-analyzer.ts` (line 38)
- `src/components/analytics/TransitAnalysisCard.tsx` (line 21)

---

## Won't Fix (Acceptable As-Is)

### WF-1: Bedrock client lazy initialization (P-2)
The lazy singleton is initialized at first call rather than at server startup. The one-time init cost (~50ms) is negligible and the pattern is consistent with other lazy clients in the codebase. Changing it would add code for no meaningful gain.

### WF-2: Alert text included in prompt (S-2)
MTA alert text from an official feed is an acceptable data source for an LLM prompt. The 150-character truncation already limits exposure. Reassess only if alert sources become user-controlled.

### WF-3: No auth on `/api/transit-analysis` (S-1 — partial)
The endpoint returns low-sensitivity derived analytics (not raw feed data). CORS origin checking provides reasonable protection for browser clients. The cost of a Redis read per request is negligible. Adding a shared secret would require a new env var and frontend change. Acceptable without auth for now; document the decision in code.

### WF-4: `TransitAnalysisCard` placement in Ridership tab (A-4)
Tab placement is a product UX decision. The current location is reasonable given the "AI insights on system performance" framing alongside impact cards. No correctness impact.

### WF-5: `AnalysisResult` / `TransitAnalysisResponse` type duplication (Q-2 — beyond cross-reference)
Full deduplication requires a shared `packages/types` workspace, which is L-effort infrastructure work beyond the scope of this feature. Accept duplication with cross-reference comments (see TASK-16).
