Last Updated: 2026-02-23

# frontend-deep-review — Code Review

---

## Executive Summary

The Railtime frontend is a thoughtfully architected real-time application with a high degree of engineering maturity. The dual-mode WebSocket/polling pattern is clearly structured, the imperative MapLibre marker system is well-separated from React's rendering cycle, and the Zustand/React Query boundary is correctly drawn. The codebase reflects iterative refinement: the alpha-beta-gamma motion system, the train state machine, and the route-dedup logic all show careful design work.

The two areas of greatest risk are security and operational correctness. The `/api/v1/conductor/announce` POST endpoint accepts arbitrary JSON with no rate limiting, no input length validation, and proxies user-supplied content directly to OpenAI and ElevenLabs — making it the highest-cost attack surface in the codebase. On the correctness side, a race condition exists in all three dual-mode hooks (`useTrainPositions`, `useAlerts`, `useArrivals`) where a socket disconnect/reconnect cycle during a pending `fallbackTimerRef` can arm a second timer without clearing the first, eventually forcing the wrong data source. There are also several dead-code and dead-state items (`_dashOffset`, `LIVENESS_TIMEOUT_MS` for trains, the disabled state machine) that should be cleaned up or commented as intentional deferrals.

---

## Strengths

- Dual-mode WS/polling fallback is cleanly structured across all three hooks with consistent lifecycle patterns.
- Zustand stores maintain tight scope: trains store holds only positions, alerts store holds only dismissed IDs, trip store holds only planner state.
- React Query is used correctly as the server-state layer; direct `fetch` is only used in `use-trip-planner.ts` where the mutation semantics (`planTrip`) justify it.
- Validation schemas (`src/lib/validation/schemas.ts`) with Zod are thorough and reusable.
- Error boundary wrapping of the map component with a domain-specific fallback is a production-quality pattern.
- The imperative marker/animation architecture (refs, not React state) is the correct approach for 300+ animated DOM elements at 60 fps.
- Dynamic imports for all MapLibre heavy utilities avoid SSR failures and large initial bundles.
- Rate limiter has two independent implementations (`src/lib/rate-limit.ts` and `src/lib/api/rate-limit.ts`) both technically correct — the duplication is the issue, not the logic.
- XSS protection on alert HTML descriptions via DOMPurify is present and correctly configured.
- Train dedup logic (winner-takes-all per segment, stability via `dedupWinnersRef`) is clever and avoids visual flickering.

---

## Critical Issues (must fix)

### C-1: Conductor announce endpoint has no rate limiting, no input length validation, and no body schema enforcement

**File:** `src/app/api/v1/conductor/announce/route.ts`
**Lines:** 236-340

The `POST /api/v1/conductor/announce` endpoint reads `request.json()` and passes the body directly to `generateAnnouncement`, which calls OpenAI chat completions and then `synthesizeSpeech` (OpenAI TTS). There is no:
- Rate limit check per IP
- Maximum length on `stationName`, `headsign`, `poiName`, or `crossStreet`
- Schema validation (any JSON with the right shape is accepted; extra fields are silently ignored)
- Authentication

A single unauthenticated caller can trigger unlimited OpenAI API calls. A `stationName` of 10,000 characters will be inserted into the prompt template and charged accordingly.

```ts
// Current — no validation at all
const body: AnnounceRequest = await request.json();
const { routeId, stationId, stationName, ... } = body;
if (!routeId || !stationName) { /* only basic check */ }
```

**Fix:** Add Zod schema validation at the top of the handler, enforce field length limits (e.g., `stationName` max 100 chars), and call the existing `checkRateLimit` from `src/lib/rate-limit.ts`.

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

The same gap exists in `src/app/api/v1/conductor/weather/route.ts` and `src/app/api/v1/conductor/news/route.ts` — all three conductor endpoints should be similarly hardened.

---

### C-2: Fallback timer double-arming race condition in dual-mode hooks

**Files:**
- `src/hooks/use-train-positions.ts` lines 87-107
- `src/hooks/use-alerts.ts` lines 99-113
- `src/hooks/use-arrivals.ts` lines 96-113

In the socket lifecycle `useEffect`, the disconnect branch creates a `fallbackTimerRef.current` without first checking whether one already exists. The cleanup of the previous effect run clears it, but the `isConnected` value can change from `true` → `false` → `true` → `false` between renders faster than the effect cleanup runs in certain StrictMode or React 19 concurrent rendering scenarios. The result is two overlapping timers both calling `setSocketActive(false)` and `queryClient.invalidateQueries`, which fires duplicate polling invalidations.

```ts
// Current — in use-train-positions.ts line 95
fallbackTimerRef.current = setTimeout(() => {
  setSocketActive(false);
  queryClient.invalidateQueries({ queryKey: queryKeys.trains });
}, FALLBACK_DELAY_MS);
// No guard: if already set, the old timer is not cleared here
```

The returned cleanup only clears on *effect re-run*, but if the same branch runs twice before the effect's cleanup fires, the first timer leaks.

**Fix:** Clear before setting in the disconnect branch:

```ts
} else {
  if (disconnectedAtRef.current === null) {
    disconnectedAtRef.current = Date.now();
  }
  // Guard: always clear before arming
  if (fallbackTimerRef.current) {
    clearTimeout(fallbackTimerRef.current);
  }
  fallbackTimerRef.current = setTimeout(() => {
    setSocketActive(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.trains });
  }, FALLBACK_DELAY_MS);
}
```

This pattern should be applied identically in `use-alerts.ts` and `use-arrivals.ts`.

---

### C-3: POI popup in SubwayMap inserts unsanitized URL parameter content into the DOM

**File:** `src/components/map/SubwayMap.tsx`
**Lines:** 300-304

The `poiName` query parameter from the URL is inserted into a MapLibre popup `setHTML` call without sanitization:

```ts
const poiName = searchParams.get('poiName');
// ...
const popup = new maplibregl.Popup({ offset: 25, closeButton: true })
  .setHTML(`<div style="padding: 4px 8px; font-weight: 500;">${poiName}</div>`);
```

`poiName` is raw user-supplied URL input. MapLibre's `setHTML` sets `innerHTML` directly. An attacker can craft a URL like:
```
/map?poi=40.7,-73.9&poiName=<img src=x onerror=alert(document.cookie)>
```

This is a stored-URL XSS vector, exploitable via shared links.

**Fix:** Sanitize before interpolation:

```ts
import { sanitizeHtml } from '@/lib/utils/sanitize';

const safeName = sanitizeHtml(poiName);
const popup = new maplibregl.Popup({ offset: 25, closeButton: true })
  .setHTML(`<div style="padding: 4px 8px; font-weight: 500;">${safeName}</div>`);
```

---

### C-4: Rate limiting is entirely disabled at the middleware layer

**File:** `src/middleware.ts`
**Lines:** 8-11

```ts
export function middleware(_request: NextRequest) {
  // Rate limiting disabled for now — the limits need tuning
  return NextResponse.next();
}
```

The project has two well-implemented rate-limiting modules (`src/lib/rate-limit.ts`, `src/lib/api/rate-limit.ts`) and a proper `RATE_LIMITS` configuration. They are dead code as long as middleware passes all requests unconditionally. All API routes are fully open to abuse.

**Risk:** In production, this means `/api/v1/conductor/announce` (see C-1), `/api/v1/trains`, and all other routes have zero request throttling.

**Fix:** Re-enable middleware with the existing `checkRateLimit` infrastructure, tuned to the real-time polling frequency. The comment acknowledges this but the fix has been deferred indefinitely.

---

## Important Improvements (should fix)

### I-1: `useTrainMarkers` effect fires `async/await` inside `forEach` — unawaited async operations

**File:** `src/components/map/hooks/useTrainMarkers.ts`
**Line:** 394

```ts
displayTrains.forEach(async (train) => {
  // await calls inside forEach — the effect body does NOT await these
  const motionState = await createMotionState(...);
});
```

`Array.prototype.forEach` ignores the return value of its callback. The `await` calls inside run, but the `useEffect` body has already completed. This means:
1. If the component unmounts while async operations are in flight, they will still resolve and attempt to mutate `trainMotionRef.current` and add markers to the (now-removed) map.
2. The `scheduleAnimation()` call at line 558 happens synchronously *before* any of the `createMotionState` promises resolve, so the first animation frame may have zero motion-based trains populated.

**Fix:** Replace `forEach(async ...)` with a `Promise.all` over an async IIFE guarded by a mounted flag:

```ts
useEffect(() => {
  let mounted = true;
  const run = async () => {
    // ... setup code ...
    await Promise.all(displayTrains.map(async (train) => {
      if (!mounted) return;
      // ... existing per-train logic ...
    }));
    if (mounted) scheduleAnimation();
  };
  run();
  return () => { mounted = false; };
}, [...deps]);
```

---

### I-2: `disconnectAll()` in SocketProvider cleanup disconnects namespace sockets owned by child hooks

**File:** `src/components/providers/SocketProvider.tsx`
**Lines:** 63-68

```ts
return () => {
  s.off('connect', onConnect);
  s.off('disconnect', onDisconnect);
  disconnectAll();  // <-- kills ALL namespace sockets
  setIsConnected(false);
  setSocket(null);
};
```

`disconnectAll()` calls `disconnectSocket()` (root) AND clears every namespace socket in `namespaceSockets`. But `useTrainPositions`, `useAlerts`, and `useArrivals` each hold their own namespace socket reference obtained via `connectNamespaceSocket`. When `SocketProvider` unmounts (e.g., during hot reload in dev or a parent route change), it kills all namespace sockets, but the child hook effects have already captured stale socket references and will not reconnect because their `isAvailable` effect deps have not changed.

**Consequence:** After a SocketProvider re-mount, the three data hooks remain in a zombie state: `isConnected=false`, no reconnect attempt, no polling fallback (because `socketActive` is still `true` from the previous session), until the FALLBACK_DELAY_MS timer fires.

**Fix:** Either:
- Expose a "reset" event from SocketProvider that child hooks can listen to, or
- Remove `disconnectAll()` from the SocketProvider cleanup (since namespace sockets are independently owned by child hooks), and add explicit namespace socket disconnect in each hook's cleanup:

```ts
// In use-train-positions.ts useEffect cleanup:
return () => {
  s.off('connect', onConnect);
  s.off('disconnect', onDisconnect);
  s.disconnect();  // Disconnect only this namespace socket
};
```

---

### I-3: `use-analytics.ts` generates fabricated timeline data presented as real historical data

**File:** `src/hooks/use-analytics.ts`
**Lines:** 84-103

```ts
const timeline = useMemo<TimelineData[]>(() => {
  const currentCount = trains.length;
  for (let i = 11; i >= 0; i--) {
    // Use current train count for all time slots (historical disabled)
    result.push({
      time: time.toLocaleTimeString(...),
      arrivals: currentCount,   // same value for all 12 slots
      departures: currentCount, // same value for all 12 slots
    });
  }
  return result;
}, [trains.length]);
```

The arrivals timeline chart will render a flat horizontal line at the current train count for all 12 time points going back 1 hour. This looks like real historical data to users but is meaningless. The `avgDelay` is hardcoded to `2` (line 124). These values are misleading.

**Fix:** Either:
- Replace with explicit placeholder UI that communicates "historical data unavailable", or
- Remove these fields from the returned `AnalyticsData` type and the corresponding chart components while the feature is disabled.

---

### I-4: `useMapAnimation` stale closure for `animateTrains` — `options.refreshInterval` captured at creation

**File:** `src/components/map/hooks/useMapAnimation.ts`
**Lines:** 270-456

`animateTrains` is memoized with `useCallback` and captures `options.refreshInterval` at the time of creation. The legacy animation loop uses it to compute `progress`:

```ts
const progress = Math.min(elapsed / options.refreshInterval, 1);
```

`options` is passed by value as a plain object from `SubwayMap.tsx`. If `refreshInterval` changes (which it currently does not, but could if passed as a prop), the stale value will be used inside the animation loop until the next `useCallback` invalidation. More critically, `animateTrainsRef.current` is updated to the latest `animateTrains` (line 461), but the rAF loop calls `animateTrainsRef.current?.()` which is the latest ref — so this particular path is actually safe. However, the `hasMovingTrains` callback (line 251) captures `options.refreshInterval` without it being in its deps, meaning it can check progress against an old interval value.

**Fix:** Either pass `refreshInterval` as a `useRef` so it's always current, or add it to all `useCallback` dependency arrays where it's used.

---

### I-5: `ConductorProvider` leaks `setInterval` for news and `setTimeout` chains for hourly weather — no cleanup IDs stored

**File:** `src/components/conductor/ConductorProvider.tsx`
**Lines:** 190-186**

```ts
// No return value stored:
setInterval(playNews, 10 * 60 * 1000);

// scheduleHourlyWeather uses nested setTimeout without cleanup
const scheduleHourlyWeather = () => {
  setTimeout(() => {
    playWeather();
    scheduleHourlyWeather();  // Recurses — no stop condition, no ID stored
  }, msUntilNextHour);
};
```

The effect cleanup (line 200-205) only clears `announcementTimerRef` and pauses audio. The `setInterval` for news and the recursive `setTimeout` chain for hourly weather are never cleared on unmount. In Next.js App Router, components can remount (e.g., during navigation to another route and back), creating duplicate interval/timer stacks with each mount.

**Fix:** Store all timer IDs in refs and clear them in the cleanup:

```ts
const newsIntervalRef = useRef<NodeJS.Timeout | null>(null);
const weatherTimeoutRef = useRef<NodeJS.Timeout | null>(null);

// In startOnInteraction:
newsIntervalRef.current = setInterval(playNews, 10 * 60 * 1000);

// Cleanup:
return () => {
  if (newsIntervalRef.current) clearInterval(newsIntervalRef.current);
  if (weatherTimeoutRef.current) clearTimeout(weatherTimeoutRef.current);
  // ...
};
```

---

### I-6: `trainPositions` data source split — trains array is returned from `useTrainPositions` but also written to Zustand `trainsStore`; consumers use both in parallel

**Files:**
- `src/hooks/use-train-positions.ts` lines 120-128 (writes to Zustand)
- `src/components/map/SubwayMap.tsx` line 63 (reads from hook return value, not store)
- `src/components/layout/AppSidebar.tsx` (may read from store directly — need to verify)

The hook both writes to the Zustand store (`updateTrains`) AND returns `socketTrains` / `query.data.trains` directly. The map page passes `trains` from the hook return value to `SubwayMap`. But the Zustand store is also maintained in parallel. This creates two canonical sources for train data:
1. Hook return value (what the map uses)
2. `useTrainsStore().trains` (what components calling `getTrainsByRoute` use)

In WS mode, the hook returns `socketTrains` (state local to the hook) while also calling `updateTrains` on the Zustand store. These should be identical, but they go through separate `useState` update cycles, so the Zustand store and the hook's local state can be one render behind each other.

**Recommendation:** Choose one source of truth. Either:
- Make the hook the authority: remove Zustand `trainsStore` writes from the hook and have all consumers call `useTrainPositions()`, or
- Make Zustand the authority: have the hook write to Zustand and return `useTrainsStore(s => Object.values(s.trains))`.

The current hybrid increases complexity without benefit.

---

### I-7: POI marker coordinates are in lat/lon order from URL but the comment implies lon/lat for MapLibre

**File:** `src/components/map/SubwayMap.tsx`
**Lines:** 272-314

```ts
const [lat, lon] = poiParam.split(',').map(Number);
// ...
new maplibregl.Marker({ element: el, anchor: 'bottom' })
  .setLngLat([lon, lat])   // Correct: MapLibre uses [lng, lat]
// ...
map.current.flyTo({
  center: [lon, lat],       // Correct
```

This is actually correctly handled — URL is `lat,lon` order and MapLibre gets `[lon, lat]`. However, there is no bounds validation on the parsed coordinates. A URL `?poi=999,999` will call `flyTo` with out-of-bounds coordinates and trigger a MapLibre error. Add a NYC bounding box check:

```ts
if (!isNaN(lat) && !isNaN(lon) &&
    lat >= 40.4 && lat <= 41.0 &&
    lon >= -74.3 && lon <= -73.6) {
  // Proceed with marker creation
}
```

---

### I-8: Two duplicate rate-limit modules with different APIs — dead code risk

**Files:**
- `src/lib/rate-limit.ts` — `checkRateLimit(identifier, pathname)` style (path-based config lookup)
- `src/lib/api/rate-limit.ts` — `checkRateLimit(identifier, config)` style (caller provides config)

Both exist, neither is called from middleware (which is disabled). Individual routes do not import either. This is dead code for both files. When rate limiting is eventually re-enabled, the team will need to decide which API to use, and the duplication increases the chance of only partially enabling it.

**Fix:** Pick one module and delete the other. The `src/lib/rate-limit.ts` variant (path-based config) is better suited to middleware-level enforcement.

---

### I-9: `useArrivals` unsubscribes from the wrong `stopId` on cleanup when `stopId` changes

**File:** `src/hooks/use-arrivals.ts`
**Lines:** 116-124

```ts
useEffect(() => {
  return () => {
    if (socket?.connected && prevStopIdRef.current) {
      socket.emit('unsubscribe:station', prevStopIdRef.current);
      prevStopIdRef.current = null;
    }
  };
}, [socket, stopId]);  // <-- stopId in deps triggers this on every stopId change
```

When `stopId` changes, this effect's cleanup runs and emits `unsubscribe:station` for `prevStopIdRef.current` (which is the OLD stop). But the lifecycle effect (lines 76-113) has already subscribed to the NEW stopId and updated `prevStopIdRef.current` to the new stop. Because React runs cleanup before the next effect, `prevStopIdRef.current` at cleanup time is the NEW stop (just set by the lifecycle effect), not the old one. The wrong stop gets unsubscribed.

**Fix:** Capture the stop to unsubscribe before it changes:

```ts
useEffect(() => {
  const stationToUnsubscribe = prevStopIdRef.current;
  return () => {
    if (socket?.connected && stationToUnsubscribe && stationToUnsubscribe !== stopId) {
      socket.emit('unsubscribe:station', stationToUnsubscribe);
    }
  };
}, [socket, stopId]);
```

---

### I-10: `ArrivalBoard.stopName` is set to `null` by socket path but typed as `string | null` — consumers may not handle `null`

**File:** `src/hooks/use-arrivals.ts`
**Lines:** 138-143**

```ts
setSocketArrivals({
  stopId: data.stationId,
  stopName: null,           // Always null from WS path
  updatedAt: data.updatedAt,
  now: new Date().toISOString(),
  arrivals: data.arrivals,
});
```

The polling path populates `stopName` from the API response. The WS path always sets it to `null`. Any component that uses `arrivals.stopName` will render nothing in WS mode. Verify `ArrivalBoard.tsx` handles this (it probably does, but it's an implicit contract violation).

---

## Minor Suggestions (nice to have)

### M-1: `eslint-disable-next-line react-hooks/exhaustive-deps` in SubwayMap.tsx map init effect is hiding missing dep on `mapCenter`/`mapZoom`

**File:** `src/components/map/SubwayMap.tsx` lines 242-244

The map init effect intentionally runs only once. The suppression is valid but undocumented. Add a comment explaining why `mapCenter` and `mapZoom` are intentionally excluded (they represent the *initial* viewport, not a reactive one):

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
// Intentional: mapCenter/mapZoom are initial viewport only; map manages its own state after init
}, []);
```

### M-2: Dead state in `useTripRouteLayer` — `_dashOffset` and `_setDashOffset`

**File:** `src/components/map/hooks/useTripRouteLayer.ts` line 571

```ts
const [_dashOffset, _setDashOffset] = useState(0);
```

This state was presumably for an animated dash pattern that was not implemented. The `_` prefix acknowledges it's unused. Remove it.

### M-3: Module-level `refreshInterval` constant at bottom of `useTrainMarkers.ts` shadows the hook parameter

**File:** `src/components/map/hooks/useTrainMarkers.ts` line 1084

```ts
// Module-level constant for refresh interval fallback
const refreshInterval = 15000;
```

This is declared at module scope at the bottom of the file, shadowing the `refreshInterval` parameter of the `createMotionState` function which uses `refreshInterval` from an outer reference. The module-level constant is unused (the function uses the outer-scope `refreshInterval` from the hook). Remove it.

### M-4: `loadRouteTerminals` and `loadTrackUtils` in `useTrainMarkers.ts` store results in module-level mutable singletons — no error retry on failure

**File:** `src/components/map/hooks/useTrainMarkers.ts` lines 54-82, 121-138

If `loadRouteTerminals()` fails (network error on `/data/route-segments.json`), `routeTerminals` remains `null` and `isAtFirstStop`/`isAtLastStop` will silently return `false` for all trains, meaning the entry/exit gates are effectively disabled. The same applies to `loadTrackUtils`. Add error logging and consider a retry mechanism.

### M-5: `useAnalytics.ts` hardcodes `totalStations: 472` — should come from `useStaticData`

**File:** `src/hooks/use-analytics.ts` line 133

```ts
totalStations: 472,
```

The actual station count is available at runtime from `useStaticData()`. Using a hardcoded constant will go stale as station data changes.

### M-6: `ConductorProvider` `playAnnouncement` and `scheduleNextAnnouncement` are declared inside the component but called by `scheduleHourlyWeather`/`setInterval` closures — stale closure risk

**File:** `src/components/conductor/ConductorProvider.tsx` lines 50-155

The `playAnnouncement` and `scheduleNextAnnouncement` functions are recreated on every render but the `setTimeout`/`setInterval` callbacks captured at `startOnInteraction` time hold references to the initial render's versions. Since `trainsRef` and `stationsRef` are used (which are always current), the data stale closure risk is mitigated, but any future changes to these functions that capture component state will silently break.

### M-7: `AlertCard.tsx` — `formatTimeRange` function is defined inside the component and called on every render without `useCallback` or extraction

**File:** `src/components/alerts/AlertCard.tsx` lines 33-56

`formatTimeRange` uses `alert` from the outer scope but has no dependencies that change independently — it is purely a derived value from `alert`. Extract as a pure function outside the component or `useMemo`/`useCallback` it.

### M-8: `use-analytics.ts` — `feedStatus` memoization creates a new `fallbackTimestamp` on every render cycle, breaking memo stability

**File:** `src/hooks/use-analytics.ts` lines 107-118

```ts
const feedStatus = useMemo<FeedStatus[]>(() => {
  const fallbackTimestamp = new Date().toISOString();  // New string on every memo run
  return feedQueries.map((q, i) => {
    if (q.data) return q.data;
    return { feedId: ..., lastPoll: fallbackTimestamp, ... };
  });
}, [feedQueries]);
```

The comment says "stable fallback timestamp to avoid memoization breaks" but `new Date().toISOString()` inside `useMemo` actually produces a new value on every memo invalidation. It is not stable — it only *appears* stable because `feedQueries` changes when queries resolve. This is misleading but not harmful.

---

## Architecture Considerations

### Data Source Duality — Single Source of Truth Needed

The most significant architectural issue is the train data living in two places simultaneously: `useTrainPositions` hook state and `useTrainsStore` Zustand store. The hook writes to the store on every WS push, and the store is also consumed by other components. This means any bug that causes the hook's local state and the store to diverge will manifest as visual inconsistency between the map (which uses hook state) and any other component reading from the store. Resolving this to a single canonical source would simplify the entire data flow.

### Rate Limiting Architecture

The application has sophisticated rate-limiting infrastructure that is entirely inactive in production. The middleware comment says "limits need tuning" — the correct fix is to tune them (perhaps by reading actual production request patterns) and re-enable. The conductor endpoints in particular are high-cost and should be gated regardless of tuning uncertainty.

### Socket Client Singleton vs. Module Lifecycle

The socket client (`src/lib/socket/client.ts`) uses module-level mutable singletons (`let socket`, `const namespaceSockets`). In Next.js App Router, server-side module instances are reused across requests, but the 'use client' directive means these run client-side only. However, in development with Turbopack hot reload, module singletons can persist across hot reloads while React component trees are torn down and rebuilt. This creates a scenario where `connectNamespaceSocket` returns an already-connected socket to a newly-mounted hook that hasn't set up its event handlers yet — which is why the `queueMicrotask(() => setSocket(s))` pattern exists. This is a reasonable mitigation but the root cause (mutable module singletons) is fragile.

### Performance — Station Markers at Zoom

`useStationMarkers` correctly gates display at `MAP_CONSTANTS.STATION_MIN_ZOOM` and calls `clearAllMarkers()` when below the threshold. However, it re-creates all station markers on every zoom change above the threshold (the entire `filteredStations` array is reprocessed). With 472 parent stations, this could produce 472 marker operations on every zoom event. Consider using MapLibre native GeoJSON layers for stations instead of individual `maplibregl.Marker` instances to reduce DOM pressure.

### `createPopupHTML` Duplication

The `createPopupHTML` function and `createPopupHTMLForAnimation` in `useTrainMarkers.ts` and `useMapAnimation.ts` respectively contain nearly identical HTML template logic with overlapping phase detection. This represents the same business logic expressed twice with subtle differences (one accepts `currentS/nextS`, the other reads from `state`). Extract to a shared utility in `src/lib/map/popup-html.ts`.

---

## Testing Gaps

### No tests for:
- `src/hooks/use-alerts.ts` — WS socket path (only polling path is tested)
- `src/hooks/use-arrivals.ts` — WS socket path (tests only cover polling)
- `src/components/map/hooks/useStationMarkers.ts` — zero tests
- `src/components/map/hooks/useTripRouteLayer.ts` — zero tests
- `src/components/map/SubwayMap.tsx` — zero tests (high blast radius, zero coverage)
- `src/app/api/v1/conductor/announce/route.ts` — zero tests (most expensive endpoint)
- `src/app/api/v1/trains/route.ts` — zero tests
- `src/app/api/v1/trip/route.ts` has tests but they do not test the Neo4j → in-memory fallback path
- `src/lib/mta/train-positions.ts` — zero tests for `calculateTrainPositions`
- `src/stores/geolocation-store.ts` — zero tests
- `src/components/analytics/` — zero tests for any analytics component

### Weak tests:
- `src/hooks/use-arrivals.test.ts` — mocks `SocketProvider` as always returning `isAvailable: false` (line not shown, but inferred from no WS test cases), so the WS branch of `useArrivals` is never exercised
- `src/hooks/__tests__/use-train-positions-ws.test.ts` — `connectNamespaceSocket` mock returns `null` when `mockSocketConnected = false` but the real function returns a non-connected socket (calls `connect()` on it). The mock contract doesn't match the real behavior.

---

## Top 10 Actionable Recommendations (Prioritized)

1. **[Security/Critical] Add input validation and rate limiting to all three `/api/v1/conductor` endpoints.** These proxy to paid AI APIs with no per-IP throttle and no field length limits. Use the existing Zod schema infrastructure and re-enable `checkRateLimit` from `src/lib/rate-limit.ts`. Time estimate: 2-4 hours.

2. **[Security/Critical] Sanitize `poiName` URL parameter before inserting into MapLibre `setHTML` popup.** Use the existing `sanitizeHtml` from `src/lib/utils/sanitize.ts`. One-line fix. Time estimate: 15 minutes.

3. **[Security/High] Re-enable rate limiting middleware.** Start with conservative limits (2x current polling rate), then tune. The infrastructure exists in `src/lib/rate-limit.ts`; the middleware just needs to call it. Time estimate: 1-2 hours.

4. **[Correctness/High] Fix the fallback timer double-arming race condition in all three dual-mode hooks.** Add `if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)` before every `fallbackTimerRef.current = setTimeout(...)` assignment in the disconnect branch. Time estimate: 30 minutes.

5. **[Correctness/High] Fix `useArrivals` unsubscribing the wrong station on stopId change.** Capture `prevStopIdRef.current` in a local variable before the cleanup closure runs. Time estimate: 30 minutes.

6. **[Correctness/High] Fix `useTrainMarkers` `forEach(async ...)` — add mounted guard and `Promise.all`.** Prevents attempting to add markers to an unmounted map component. Time estimate: 1-2 hours.

7. **[Correctness/Medium] Fix `ConductorProvider` timer/interval leaks on unmount.** Store `setInterval` and recursive `setTimeout` IDs in refs and clear them in the effect cleanup. Time estimate: 1 hour.

8. **[Architecture/Medium] Fix `disconnectAll()` in `SocketProvider` cleanup — it kills namespace sockets owned by child hooks.** Replace with individual namespace socket disconnect in each hook's cleanup, and remove `disconnectAll()` from `SocketProvider`. Time estimate: 2-3 hours (needs careful regression testing).

9. **[Maintainability/Medium] Resolve the two rate-limit modules duplication.** Delete `src/lib/api/rate-limit.ts` (which has a worse API for middleware use) and standardize on `src/lib/rate-limit.ts`. Update all imports. Time estimate: 1 hour.

10. **[Analytics Integrity/Medium] Remove or explicitly label the fabricated timeline data in `useAnalytics`.** Replace the flat "all slots = current count" timeline with a skeleton/empty state that communicates that historical data is unavailable. Remove hardcoded `avgDelay: 2` and `totalStations: 472`. Time estimate: 2-3 hours.

---

*Review conducted against: 253 files across `src/`, git branch `main`, commit `1d850fe`.*
