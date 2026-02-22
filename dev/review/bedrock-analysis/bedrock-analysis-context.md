Last Updated: 2026-02-22

# bedrock-analysis — Context Document

## Files Reviewed

### New Files

| File | Purpose |
|------|---------|
| `server/src/analytics/transit-analyzer.ts` | Core Bedrock engine: builds prompt from flush data, calls `claude-sonnet-4` via Bedrock `InvokeModelCommand`, caches `AnalysisResult` in Redis with a 10-min TTL. Exports `generateAnalysis(input)` and `AnalysisInput` interface. |
| `server/src/api/transit-analysis.ts` | HTTP handler for `GET /api/transit-analysis`. Reads `AnalysisResult` from Redis. Returns 200 with data or 202 with "generating" placeholder. Minimal — ~55 lines. |
| `src/components/analytics/TransitAnalysisCard.tsx` | React card component. Uses a module-level cache (survives tab-switch remounts). Fetches from WS server with `NEXT_PUBLIC_WS_URL`. Parses response into visual sections. Auto-refreshes every 10 min. |

### Modified Files

| File | Change |
|------|--------|
| `server/src/analytics/metrics-collector.ts` | Added `latestAlertDetails` module-level variable (line 91) to capture alert context. Added `generateAnalysis()` fire-and-forget call (lines 749–758) at the end of successful `flush()`. |
| `server/src/index.ts` | Added import of `handleTransitAnalysis` and URL routing branch for `/api/transit-analysis` inside the raw HTTP request handler (lines 50–53). |
| `src/components/analytics/index.ts` | Added barrel export for `TransitAnalysisCard` (line 11). |
| `src/app/(dashboard)/analytics/page.tsx` | Added `TransitAnalysisCard` import and rendered it inside `TabsContent value="ridership"` (line 211). `EquipmentStatusCard` was NOT removed from this file — it was already absent here. |
| `server/package.json` | Added `@aws-sdk/client-bedrock-runtime: ^3.995.0` to dependencies (line 16). |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SERVER (EC2, port 3001)                       │
│                                                                   │
│  MTA GTFS-RT feeds (every 15s)                                   │
│       │                                                           │
│       ▼                                                           │
│  feed-loop.ts ──► collectMetrics() ──► in-memory buffers         │
│                                                                   │
│  alert-loop.ts ──► collectAlertEvent() ──► latestAlertDetails    │
│                                                                   │
│  [every 5 min] setInterval fires flush()                         │
│       │                                                           │
│       ├──► writeMetrics/writeEvents/writeRollups ──► DynamoDB    │
│       │                                                           │
│       └──► generateAnalysis() [fire-and-forget]                  │
│                │                                                  │
│                ▼                                                  │
│         buildPrompt(metrics, rollups, events, alerts)            │
│                │                                                  │
│                ▼                                                  │
│         BedrockRuntimeClient.send(InvokeModelCommand)            │
│         model: us.anthropic.claude-sonnet-4-20250514-v1:0        │
│                │                                                  │
│                ▼                                                  │
│         setCache('transit-analysis:latest', result, 600s)        │
│                │                                                  │
│                ▼                                                  │
│              Redis                                                │
│                │                                                  │
│  GET /api/transit-analysis                                       │
│       │                                                           │
│       ▼                                                           │
│  handleTransitAnalysis ──► getCache() ──► 200 (or 202 pending)  │
└─────────────────────────────────────────────────────────────────┘
                    │
                    │ HTTP (NEXT_PUBLIC_WS_URL)
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FRONTEND (Vercel / Next.js)                     │
│                                                                   │
│  TransitAnalysisCard                                             │
│    ├── useState(getCachedResult)  ← module-level cache check     │
│    ├── useEffect → fetchAnalysis() if cache stale               │
│    ├── setInterval 10min → fetchAnalysis()                       │
│    └── parseAnalysisSections(data.analysis)                      │
│         └── renders sections with icons (Brain/Trending/etc)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions and Rationale

### 1. Fire-and-Forget from `flush()`
`generateAnalysis()` is called with `.catch()` inside the `try` block after the DynamoDB writes succeed. This means:
- A Bedrock failure never breaks the metrics pipeline.
- Analysis is only generated on successful flushes (meaningful data available).
- No await means the flush does not block on the Bedrock call (~1–3s latency).

**Rationale:** Correct. The analytics pipeline is the critical path; AI analysis is value-add. Decoupling via fire-and-forget is the right pattern.

### 2. Two-Layer Cache
- **Server (Redis):** `transit-analysis:latest` with 10-min TTL. 2× the flush interval provides a safety margin: if one flush fails, the previous analysis remains valid for one more cycle.
- **Client (module-level variable):** Survives React remount (tab switching). Avoids re-fetching on every tab visit. 10-min max age matches server TTL.

**Rationale:** The module-level cache is a pragmatic workaround for the remount-on-tab-switch behavior confirmed in the commit log. It is unconventional (departs from TanStack Query) but solves the problem. See finding A-3 for the recommended migration to `useQuery` with `staleTime`.

### 3. HTTP over WebSocket for this endpoint
Analysis is fetched via a plain HTTP `GET` rather than a Socket.IO event, even though the WS server also handles Socket.IO. This is appropriate because:
- Analysis is pulled on demand (every 10 min), not pushed in real time.
- The WS transport is reserved for high-frequency real-time data (trains, alerts, arrivals).
- HTTP is simpler, cacheable, and easier to debug.

### 4. Prompt pre-computation
`buildPrompt()` pre-computes derived signals (direction imbalances, cascading anomalies, ahead-of-schedule routes) before sending them to the model. This reduces the model's analytical work, improves consistency, and ensures signals are computed with full precision (not inferred from rounded prompt values).

**Rationale:** Strong pattern. The model is asked to connect pre-computed signals, not recompute raw metrics.

### 5. Bedrock over direct Anthropic API
Using AWS Bedrock (not `api.anthropic.com`) keeps all infrastructure within AWS, reuses the existing IAM role pattern used by DynamoDB, and avoids managing a separate API key. The model ID `us.anthropic.claude-sonnet-4-20250514-v1:0` uses the US cross-region inference profile, which provides automatic failover across AWS regions.

---

## Integration Points with Existing System

| Integration Point | How |
|-------------------|-----|
| `metrics-collector.ts` flush cycle | `generateAnalysis` is called at line 750 after `writeMetrics/writeEvents/writeRollups` complete |
| `metrics-collector.ts` alert tracking | `latestAlertDetails` is populated by `collectAlertEvent()` and read by `flush()` at the `generateAnalysis` call site |
| `server/src/lib/redis.ts` | `getCache` / `setCache` from existing Redis abstraction — no new Redis code |
| `server/src/index.ts` HTTP router | Routed inline in the `createServer` callback alongside the health check — no new framework |
| `src/components/analytics/index.ts` | Standard barrel export — consistent with all other analytics components |
| `src/app/(dashboard)/analytics/page.tsx` | Rendered inside `ErrorBoundary` — crash-safe |
| `NEXT_PUBLIC_WS_URL` env var | Used by frontend to construct the fetch URL — already set in production |
| EC2 instance profile IAM role | Bedrock permissions must be added to the `railtime-ec2-dynamodb` IAM role (see Security finding S-1) |

---

## EquipmentStatusCard Status

`EquipmentStatusCard` is confirmed NOT dead code. It is imported and used in `src/app/(dashboard)/alerts/page.tsx`. It was never in `analytics/page.tsx` — the commit that "swapped EquipmentStatusCard → TransitAnalysisCard" only added `TransitAnalysisCard` to the ridership tab (where `EquipmentStatusCard` was never present). The original description was slightly misleading.
