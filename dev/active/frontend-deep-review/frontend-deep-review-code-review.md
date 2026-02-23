Last Updated: 2026-02-23

# frontend-deep-review — Code Review

---

## Executive Summary

This review covers the complete UI layer: five Zustand stores, 20+ custom hooks, 14 analytics components, all layout/alert/station/trip-planner components, the four providers, all dashboard page routes, and the ErrorBoundary. The code is architecturally mature and the dual-mode (Socket.IO / React Query polling) data pipeline is well-engineered for resilience. The separation between server state (React Query / Apollo) and client UI state (Zustand) is largely respected. Component composition is clean, shadcn/ui primitives are used consistently, and loading/error/empty state coverage is thorough across most surfaces.

Three recurring patterns require attention before this layer is considered production-ready. First, a dual-client data architecture (Apollo Client for analytics, React Query for everything else) introduces a significant hidden cost: every analytics chart independently calls `useDailyRollups` with identical date ranges, firing multiple identical GraphQL requests in one render cycle with no deduplication coordination between components. Second, the station detail page (`/stations/[stationId]/page.tsx`) bypasses React Query entirely and manages arrivals with raw `useState` + `setInterval`, creating an architectural inconsistency and a real memory-leak risk. Third, several accessibility gaps (missing `aria-expanded`, unlabeled interactive elements, and non-semantic heading hierarchy) need remediation.

The overall quality is high. The critical and important findings below are specific and actionable; most can be resolved in one or two focused sessions.

---

## Critical Issues (must fix)

### C-1: Station detail page bypasses React Query — raw fetch + setInterval creates memory-leak risk

**File:** `src/app/(dashboard)/stations/[stationId]/page.tsx` (lines 26-60)

The page manages arrival data with `useState<ArrivalItem[]>` + a raw `setInterval(fetchArrivals, 30000)` + a manual `useCallback(fetchArrivals)`. This is the only page in the entire app that does not use React Query for server state and it introduces two real risks:

1. If the component unmounts between the `fetch` response resolving and `setArrivals` executing, React will warn about state updates on unmounted components (and in strict-mode double-invoke, this is nearly certain to fire).
2. The `setInterval` depends on `station` in the `useEffect` dependency array. If `station` changes identity (e.g., due to a parent re-render), a new interval is registered without the cleanup effect having fired first — producing duplicate polling.

The `useArrivals` hook already exists in `src/hooks/use-arrivals.ts` and handles polling, socket subscriptions, and fallback. The station detail page should use it.

**Risk:** Data staleness under navigation, stale closure bugs, potential duplicate network calls.

**Fix:** Replace the manual fetch block with:
```tsx
// Remove useState for arrivals, arrivalsLoading, error
// Remove fetchArrivals callback and the useEffect that sets the interval

// Add:
const { arrivals: arrivalBoard, isLoading: arrivalsLoading, error } = useArrivals(
  station?.feedGroup ?? '',   // requires feedGroup on Stop type, or derive from route
  stationId
);
const arrivals = arrivalBoard?.arrivals ?? [];
```

---

### C-2: Multiple analytics components issue duplicate Apollo `useDailyRollups` requests with the same variables

**Files:**
- `src/components/analytics/DelayTrendChart.tsx` (line 36)
- `src/components/analytics/BunchingGapTrendChart.tsx` (line 29)
- `src/components/analytics/RoutePerformanceTable.tsx` (line 61)
- `src/components/analytics/DelayDistributionChart.tsx` (line 86)
- `src/components/analytics/SystemHealthTimeline.tsx` (line 23)
- `src/components/analytics/BestWorstRouteCard.tsx` (line 93)
- `src/components/analytics/TripCompletionChart.tsx` (line 35)

Each of these components independently calls `useDailyRollups(from, to)`. For a 7-day range, five of them compute `from = format(subDays(new Date(), 7), 'yyyy-MM-dd')` and `to = format(new Date(), 'yyyy-MM-dd')` independently and each fires its own Apollo query.

Apollo's InMemoryCache will deduplicate identical in-flight requests, but only when `keyArgs` match exactly. Each component computes `from` and `to` independently using `new Date()` at render time. If any component renders a millisecond apart (e.g., during React concurrent rendering), the date strings will still match, but there is no guarantee that the date string construction happens in the same tick. More critically, the `cache-and-network` fetch policy (set in the Apollo client's `defaultOptions`) means every one of these components also triggers a background network refetch on mount even when the cache already has fresh data.

**Risk:** Up to 7 simultaneous identical GraphQL requests on analytics page load; potential AppSync cost and rate-limit exposure.

**Fix:** Lift the shared `useDailyRollups` call to the analytics page level and pass data down as props, or create a shared context provider:

```tsx
// analytics/page.tsx
const rollupData = useDailyRollups(sevenDaysAgo, today);

<DelayTrendChart rollupData={rollupData} />
<BunchingGapTrendChart rollupData={rollupData} />
<RoutePerformanceTable rollupData={rollupData} />
// etc.
```

Alternatively, add a custom `useSharedDailyRollups` hook that uses React Query (not Apollo) with `staleTime: Infinity` for the day and shares one fetch.

---

### C-3: ApolloProvider wraps the entire app but is used only on the analytics page

**File:** `src/app/layout.tsx` (line 57)

The `ApolloProvider` is placed in the root layout, wrapping every page (map, stations, alerts) with the Apollo client and its InMemoryCache even though GraphQL/AppSync is only consumed by analytics-layer hooks (`use-analytics-data.ts`). The Apollo client is also a module-level singleton (`apolloClient` instantiated at import time in `src/lib/graphql/client.ts`), which means it is included in every page's JS bundle.

**Risk:** Unnecessary bundle weight and memory overhead on non-analytics pages. The singleton pattern also makes the Apollo client untestable in isolation (no per-render instantiation).

**Fix:** Move `ApolloProvider` into the analytics layout or the analytics page's subtree. If the analytics section gets its own `app/(dashboard)/analytics/layout.tsx`, wrap only that subtree.

---

## Important Improvements (should fix)

### I-1: `useOperationalStats` calls three separate data hooks causing cascading re-renders

**File:** `src/hooks/use-operational-stats.ts` (lines 19-25)

`useOperationalStats` internally calls `useAnalytics()`, `useAlerts()`, and `useDailyRollups()`. Each of these has its own subscription model. When any one of them updates, `useOperationalStats` re-runs its `useMemo`, which re-renders every consumer of the stats bar. The `useAnalytics` hook itself internally calls `useTrainPositions` which polls every 15 seconds, meaning `OperationalStatsBar` re-renders at the map's polling cadence even when none of its displayed values change.

**Fix:** Extract only the specific selectors needed. For `useAnalytics`, only `data.stats.totalTrains` and `data.stats.feedHealth` are consumed. Separate those into narrower selectors or memoize the comparison at the hook boundary.

---

### I-2: `useAlerts` is instantiated 5+ times on the analytics page without data sharing

**Files:** `AlertStatusCard.tsx`, `AlertBanner.tsx` (via layout), `AlertBadge.tsx` (via sidebar), `AppSidebar.tsx`, `AnalyticsPage` (direct call)

Each instance creates its own React Query subscription to `queryKeys.alerts()`. While React Query deduplicates the network request, each hook still runs its `useMemo` for `activeAlerts`, `visibleAlerts`, and `counts` independently. With ~100+ service alerts, this is five separate passes through the alert array per polling cycle.

**Fix:** The `useAlerts` data path is a strong candidate for a React context. Create an `AlertsDataContext` that holds `alerts`, `visibleAlerts`, and `counts`, populated by a single `useAlerts()` call, and consumed by all subscribers. The dismissal actions can remain on the Zustand store.

---

### I-3: `AlertsUIState` uses `Set<string>` in Zustand — `persist` middleware will silently drop it

**File:** `src/stores/alerts-store.ts` (line 12)

`dismissedIds` is typed as `Set<string>`. Zustand's `persist` middleware serializes state to JSON. `JSON.stringify(new Set(['a', 'b']))` produces `{}` — the Set is silently lost. Currently, `useAlertsStore` does not use `persist`, so this is not an active bug. However, if someone adds persistence later (which is natural for a "dismissed alerts" feature), the data will silently vanish on every page load.

**Fix:** Either document the non-persistence explicitly in a JSDoc comment, or store `dismissedIds` as `string[]` and convert to a `Set` inside the selector. A sorted array round-trips through JSON correctly and the lookup cost is only meaningful at very large scales.

---

### I-4: `useCanPlanTrip` and `useSelectedTrip` each call `useTripStore` twice unnecessarily

**File:** `src/stores/trip-store.ts` (lines 86-100)

```typescript
export function useSelectedTrip(): TripPlan | null {
  const trips = useTripStore((state) => state.trips);           // subscription 1
  const selectedTripIndex = useTripStore((state) => state.selectedTripIndex); // subscription 2
  return trips[selectedTripIndex] ?? null;
}

export function useCanPlanTrip(): boolean {
  const originStationId = useTripStore((state) => state.originStationId);      // subscription 1
  const destinationStationId = useTripStore((state) => state.destinationStationId); // subscription 2
  const isPlanning = useTripStore((state) => state.isPlanning);                // subscription 3
  return Boolean(originStationId && destinationStationId && !isPlanning);
}
```

Each `useTripStore(selector)` call creates an independent subscription. For `useCanPlanTrip`, three Zustand subscriptions are created. Use a single combined selector with shallow equality:

```typescript
import { useShallow } from 'zustand/react/shallow';

export function useCanPlanTrip(): boolean {
  return useTripStore(
    useShallow((s) => Boolean(s.originStationId && s.destinationStationId && !s.isPlanning))
  );
}
```

---

### I-5: `useGeolocationStore` stores `watchId` in Zustand — side-effect state belongs in a ref

**File:** `src/stores/geolocation-store.ts` (line 23)

`watchId: number | null` is stored in Zustand state. Every time `watchLocation()` runs, it calls `set({ watchId: id })` which triggers a Zustand state update and re-renders all subscribers, even though no component should ever need to render based on the watch ID. This is a side-effect resource handle, not UI state. It belongs in a module-level `ref` or closure variable inside the store.

**Fix:**
```typescript
// Outside create():
let _watchId: number | null = null;

// Inside watchLocation:
_watchId = navigator.geolocation.watchPosition(...);
// No set({ watchId }) call — remove watchId from state entirely

// Inside stopWatching:
if (_watchId !== null) {
  navigator.geolocation.clearWatch(_watchId);
  _watchId = null;
  set({ status: 'idle' });
}
```

---

### I-6: `use-transit-analysis` and `use-anomaly-feed` call raw `fetch` directly — inconsistent with project pattern

**Files:**
- `src/hooks/use-transit-analysis.ts` (line 38)
- `src/hooks/use-anomaly-feed.ts` (line 27)
- `src/hooks/use-trip-planner.ts` (line 104)

The CLAUDE.md and BEST_PRACTICES pattern for this codebase is to use `mtaApi` (from `@/lib/api`) as the API abstraction layer for all requests. These three hooks call `fetch()` directly. This means they bypass any API-level error normalisation, any request interceptors, and they cannot be mocked via the `mtaApi` mock in tests.

**Fix:** Add `getTransitAnalysis` and `getAnomalyFeed` functions to `mtaApi` and update the hooks to call through it. For `use-trip-planner.ts`, the trip planning `fetch` call should similarly move to `mtaApi.planTrip(params)`.

---

### I-7: `useBackgroundSync` creates a competing `setInterval` for trains data, racing with `useTrainPositions`

**File:** `src/hooks/use-background-sync.ts` (lines 30-46)

`useBackgroundSync` runs on all non-map pages and calls `queryClient.prefetchQuery` for trains every 30 seconds. However, the stations page (`/stations/page.tsx`) also calls `useTrainPositions({ refreshInterval: 15000 })` directly (line 14), which is enabled and polling. On the stations page, trains data is being fetched at both 15-second intervals (via `useTrainPositions`) and 30-second prefetch intervals (via `useBackgroundSync`). The React Query cache deduplicates the actual network requests, but the 30s background interval is completely redundant on this page.

**Fix:** In `useBackgroundSync`, check whether the trains query is already actively polling before registering the background interval:
```typescript
const trainsQueryState = queryClient.getQueryState(queryKeys.trains);
const isAlreadyPolling = trainsQueryState?.fetchStatus === 'fetching' || ...
if (!isMapPage && !isAlreadyPolling) { ... }
```
Or, simpler: remove the background sync for trains from `useBackgroundSync` entirely and let individual pages manage their own polling. The background sync pattern is only valuable when a page genuinely has no active query for the data.

---

### I-8: `DelayTrendChart` date range recomputed on every render without memoization

**File:** `src/components/analytics/DelayTrendChart.tsx` (lines 33-34)

```typescript
const to = format(new Date(), 'yyyy-MM-dd');
const from = format(subDays(new Date(), RANGE_DAYS[range]), 'yyyy-MM-dd');
```

`new Date()` is called at the top of the render function. Every time the component re-renders (which happens on any parent state change, including 15-second train polling), two new date strings are computed and passed to `useDailyRollups`. Since `from` and `to` are the same string values between renders (they only change at midnight), Apollo's cache will hit, but the `variables` object passed to `useQuery` is a new object reference each render. Apollo compares `variables` by value, so this is safe functionally, but it is semantically misleading and adds minor overhead.

Same pattern appears in `BunchingGapTrendChart.tsx`, `RoutePerformanceTable.tsx`, `DelayDistributionChart.tsx`, `SystemHealthTimeline.tsx`, and `BestWorstRouteCard.tsx`.

**Fix:** Wrap date computation in `useMemo` with `[range]` dependency:
```typescript
const { from, to } = useMemo(() => ({
  to: format(new Date(), 'yyyy-MM-dd'),
  from: format(subDays(new Date(), RANGE_DAYS[range]), 'yyyy-MM-dd'),
}), [range]);
```

---

### I-9: `TickerSection` (AlertBanner) stops the animation on pause but restarts from the beginning on un-pause

**File:** `src/components/alerts/AlertBanner.tsx` (lines 73-92)

When the user hovers, `controls.stop()` is called. When they leave, `setIsPaused(false)` triggers the `useEffect` that restarts the animation with `controls.start({ x: -contentWidth, ... repeat: Infinity })`. Because `x: 0` is the `style` prop initial value and the animation restarts from `x: 0`, the ticker jumps back to the start rather than resuming from where it stopped.

**Fix:** Track the current `x` position and restart from there, or use `controls.pause()` / `controls.resume()` (Framer Motion's animation controls support this).

---

### I-10: `StationSearch` dropdown is not keyboard navigable and has no ARIA combobox semantics

**File:** `src/components/trip-planner/StationSearch.tsx`

The search dropdown is a `<div>` containing `<button>` elements. It has no `role="listbox"`, no `aria-expanded` on the input, no `aria-activedescendant` tracking, and no keyboard arrow-key navigation between results. Screen reader users will hear the input but get no indication that a dropdown has appeared, and cannot navigate results without a mouse.

**Fix:** Either use Radix UI's `Combobox` primitive (which shadcn/ui exposes as `Command` + `CommandInput` + `CommandList`) or manually add:
- `role="combobox"` and `aria-expanded={isOpen}` on the `<Input>` wrapper
- `role="listbox"` on the dropdown `<div>`
- `role="option"` on each result `<button>`
- `aria-activedescendant` pointing to the focused option
- `keydown` handling for `ArrowDown`/`ArrowUp`/`Enter`/`Escape`

The shadcn `Command` component would handle all of this automatically and is already a project dependency.

---

### I-11: `ErrorBoundary` does not report errors to any observability sink

**File:** `src/components/ErrorBoundary.tsx` (lines 28-30)

```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  console.error('ErrorBoundary caught an error:', error, errorInfo);
}
```

Errors are only logged to `console.error`. There is no integration with Vercel's built-in error tracking, Sentry, or any other sink. Errors that hit the boundary in production are invisible unless a developer manually checks the browser console or server logs.

**Fix:** Add error reporting. Vercel Analytics does not capture JS errors automatically. The minimum fix is:
```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  console.error('ErrorBoundary caught an error:', error, errorInfo);
  // Report to observability
  if (typeof window !== 'undefined' && window.__analytics) {
    window.__analytics.trackException(error);
  }
}
```
Or integrate `@vercel/speed-insights` / Sentry's `captureException`.

---

### I-12: `use-analytics.ts` timeline data is fabricated — misleading to users

**File:** `src/hooks/use-analytics.ts` (lines 84-103)

The `timeline` computation creates 12 time slots spanning the last hour and assigns `arrivals: currentCount, departures: currentCount` to every slot. This means all 12 bars in any timeline chart render as identical values — a flat line representing only the current train count. The comment acknowledges this: "Use current train count for all time slots (historical disabled)."

This data is consumed by `LiveSystemDashboard` but the timeline is not currently rendered there (the component only shows totals and feed groups). However, `data.timeline` is exported from `useAnalytics` and could be picked up by future consumers who would receive fabricated historical data.

**Fix:** Either remove `timeline` from the `AnalyticsData` interface entirely until historical data is re-enabled, or clearly type it as `null` when historical data is disabled:
```typescript
timeline: null, // Historical data disabled — see analytics-v2 plan
```

---

### I-13: `AlertCard.formatTimeRange` is defined as a nested function inside the component body — recreated every render

**File:** `src/components/alerts/AlertCard.tsx` (lines 33-56)

`formatTimeRange` is defined as a function with `const formatTimeRange = () => {...}` inside the component body. It has no dependencies on props or state, yet it is recreated on every render. Because `AlertList` renders all active alerts and re-renders on every `useAlerts` polling cycle, this is a real cost at scale with 50+ alerts.

**Fix:** Move `formatTimeRange` outside the component or make it a standalone utility function in `@/lib/mta/format.ts`.

---

### I-14: `useMultiStationArrivals` uses a hardcoded non-namespaced query key

**File:** `src/hooks/use-multi-station-arrivals.ts` (line 45)

```typescript
queryKey: ['multi-arrivals', station.id],
```

The rest of the codebase uses `queryKeys` from `@/lib/api/query-keys` for all React Query cache keys. This hardcoded string bypasses the centralised key registry, making it invisible to cache invalidation strategies and impossible to find via search.

**Fix:** Add `multiArrivals: (stationId: string) => ['arrivals', 'multi', stationId] as const` to `queryKeys` in `@/lib/api/query-keys.ts` and use it here.

---

### I-15: `AnomalyFeed` event list uses a composite key that includes the array index

**File:** `src/components/analytics/AnomalyFeed.tsx` (line 139)

```tsx
key={`${event.pk}-${event.timestamp}-${i}`}
```

Including `i` (the array index) in the key means React cannot reuse DOM nodes when the array is sorted or filtered. If `typeFilter` or `routeFilter` changes, all existing items get unmounted and new ones mounted even when the underlying event data is identical. The `pk` + `timestamp` combination should already be unique; `i` adds nothing and actively harms reconciliation.

**Fix:** `key={`${event.pk}-${event.timestamp}`}`

---

## Minor Suggestions (nice to have)

### M-1: `RouteFilter` `checkScroll` function leaks a resize listener that is not associated with the scroll container's actual content changes

**File:** `src/components/layout/RouteFilter.tsx` (lines 20-32)

`checkScroll` is called on `window.resize` but not when the scrollable container's content height changes (e.g., when the sidebar transitions from expanded to compact). The initial `checkScroll()` call in `useEffect` runs once on mount, but the compact/expanded transition that changes content height is not tracked. The `canScrollUp/Down` state may be stale after a sidebar state change. Consider also calling `checkScroll` when `compact` prop changes.

---

### M-2: `SubwayMapModal` configures PDF.js worker from an unpkg CDN URL — fragile for production

**File:** `src/components/layout/SubwayMapModal.tsx` (line 40)

```typescript
pdfjs.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.pdfjs.version}/build/pdf.worker.min.mjs`;
```

This fetches the PDF worker from unpkg at runtime. If unpkg is unavailable or rate-limits the request, PDF loading fails silently (the spinner never resolves). Vendor the worker file in `public/` or use the Next.js public CDN for reliability.

---

### M-3: `html lang="en"` is hardcoded to dark mode — theme system is disconnected

**File:** `src/app/layout.tsx` (line 30)

```tsx
<html lang="en" className="dark">
```

The `useUIStore` has a `theme` field with `'light' | 'dark' | 'system'` values, but the root `<html>` element has `className="dark"` hardcoded. The theme preference is persisted to localStorage but never applied to the DOM. This means the dark/light toggle in the UI store has no visual effect.

**Fix:** Add a theme-applier component that reads `useUIStore((s) => s.theme)` and syncs `document.documentElement.classList` accordingly (standard next-themes pattern).

---

### M-4: `StationCard` uses `<span role="button">` for the map navigation trigger — a real `<button>` is more appropriate

**File:** `src/components/stations/StationCard.tsx` (lines 84-90)

The location name span uses `role="button"` and `tabIndex={0}` with a manual `onKeyDown` handler. This is a valid ARIA pattern but it is more work than a `<button>` element that handles keyboard semantics automatically and participates in the standard focus order. The nested interactive element (a `<button>` inside a `<Link>`) requires care — use `e.stopPropagation()` on the button click, which is already done, so a real `<button>` is fine here.

---

### M-5: `AlertList` has a redundant null-check after the guard clause

**File:** `src/components/alerts/AlertList.tsx` (lines 20, 31)

```typescript
if (!alerts?.length) { return ... }
// ...
{(alerts ?? []).map(...)}
```

The early return already guarantees `alerts` is a non-empty array at line 31. The `?? []` fallback is dead code. Remove it for clarity.

---

### M-6: `TransitAnalysisCard` has a dead code path — the `!data && !isLoading` branch can never render

**File:** `src/components/analytics/TransitAnalysisCard.tsx` (lines 74-93)

```typescript
if (error || (!data && !isLoading)) {
  return <...error/no-data state...>
}
if (!data) {
  return <...loading state...>
}
```

The second guard (`if (!data)`) can only be reached when `error` is falsy AND `(!data && !isLoading)` is also falsy AND `!data` is truthy. That means `isLoading` must be `true`. So the second branch is the "loading with no cached data" state — but the label on this branch says "Loading state (no cached data yet)" which is correct. The issue is that the first guard's `(!data && !isLoading)` case represents a permanently-failed state that shows the error card, not a loading card. This logic is correct but the two `!data` branches with different intents could be collapsed and clarified.

---

### M-7: `EquipmentStatusCard` inline SVG for escalator icon should be an extracted component or a proper icon

**File:** `src/components/analytics/EquipmentStatusCard.tsx` (lines 41-46)

```tsx
<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
  <path d="M4 18h4l3-6 3 6h6" />
  <path d="M4 6h4l3 6" />
  <path d="M14 6h6" />
</svg>
```

This inline SVG has no `title`, no `aria-hidden`, and no `aria-label`. Screen readers will announce the SVG as a nameless image. Either add `aria-hidden="true"` (if decorative) or extract it as a named icon component with an accessible label.

---

### M-8: `RoutePerformanceTable` IIFE inside JSX for grade rendering adds visual noise

**File:** `src/components/analytics/RoutePerformanceTable.tsx` (lines 187-195)

```tsx
{(() => {
  const gradeResult = calculateGrade(row);
  return gradeResult ? (
    <span ...>{gradeResult.grade}</span>
  ) : (
    <span ...>-</span>
  );
})()}
```

This IIFE pattern creates a new function closure per row per render. The same result can be achieved with a small `GradeCell` sub-component or by computing `gradeResult` outside the JSX:

```tsx
function GradeCell({ row }: { row: RouteSummary }) {
  const result = calculateGrade(row);
  return result ? (
    <span className={`font-bold text-lg ${result.color}`}>{result.grade}</span>
  ) : (
    <span className="text-muted-foreground">-</span>
  );
}
```

---

### M-9: `DelayDistributionChart.computeDistribution` approximation is documented nowhere

**File:** `src/components/analytics/DelayDistributionChart.tsx` (lines 40-77)

The distribution computation uses `avgDelay` to bucket the late fraction of trips into delay categories. This is a statistical approximation — if a route has 30% late trips and an avgDelay of 90s, all 30% are bucketed into "0-2 min" even though the actual distribution could be bimodal. The chart will display this as if it is measured data. A brief disclaimer comment in the UI (or a `(estimated)` label) would prevent the data from being misread.

---

### M-10: `use-mobile.ts` missing `'use client'` directive

**File:** `src/hooks/use-mobile.ts` (line 1)

All other hooks in `src/hooks/` start with `'use client'`. `use-mobile.ts` does not have this directive. It uses `React.useEffect` and `window`, which are client-only APIs. While Next.js will likely infer client-only context from usage, the missing directive is an inconsistency that could cause confusing server-side build errors if the file is ever imported outside a `'use client'` tree boundary.

---

## Architecture Considerations

### Dual data-client architecture (Apollo + React Query)

The co-existence of Apollo Client (for AppSync/GraphQL analytics) and React Query (for REST/MTA data) is architecturally justified by the different backend services they target. However, the two clients have separate caches with no cross-talk. The `useOperationalStats` hook bridges them — it reads from `useAnalytics` (React Query) and `useDailyRollups` (Apollo) in the same hook. This makes it impossible to write a unified loading state without knowing which cache is stale. Consider establishing a clear rule: Apollo is for AppSync historical/aggregated analytics only; React Query is for everything else. Document this at the top of `src/hooks/use-analytics-data.ts`.

### `SocketProvider` cleanup calls `disconnectAll()` on unmount

**File:** `src/components/providers/SocketProvider.tsx` (line 66)

The root `SocketProvider` cleanup function calls `disconnectAll()`. In development with React strict mode, this effect runs twice — connect, then immediately disconnect all sockets including namespace sockets that individual hooks may have opened. The namespace sockets (`/trains`, `/alerts`, `/arrivals`) are each managed by their own `useEffect` in the consuming hooks, but `disconnectAll()` from the parent provider will tear them down unexpectedly. Verify that `disconnectAll` only disconnects the root socket managed by this provider, not namespace sockets opened by hooks.

### `PrefetchProvider` renders `null` for `ConductorProvider`

**File:** `src/app/(dashboard)/layout.tsx` (line 39)

```tsx
<ConductorProvider>{null}</ConductorProvider>
```

This renders a provider with no children that renders nothing. Either `ConductorProvider` has side effects (in which case the pattern is unusual but intentional and should be documented with a comment) or it is dead code pending removal. If it is an AI tour guide provider, the intent should be made explicit.

### `useTrainPositionsSuspense` hook is defined but never imported by any component

**File:** `src/hooks/use-train-positions-suspense.ts`

This hook exists as a standalone file and is exported from `src/hooks/index.ts` (presumably). No component in the reviewed codebase calls it. If this was a planned enhancement for Suspense-based loading boundaries, it should be documented. If it is superseded by the current `useTrainPositions` approach, it should be removed to avoid confusion.

### `use-analytics.ts` timeline is placeholder data, yet `avgDelay` is hardcoded to `2`

**File:** `src/hooks/use-analytics.ts` (line 124)

```typescript
const avgDelay = 2;
```

A hardcoded magic number `2` is assigned to `avgDelay` and fed into `data.stats.avgDelay`. This value is displayed nowhere currently visible in the analytics page, but it is exported in the `AnalyticsData` type. If it were rendered, it would show a permanent "2 minute average delay" regardless of actual conditions. Either compute this from the Apollo rollup data or set it to `null` with a `number | null` type.

### Recharts tooltip `wrapperStyle={{ zIndex: 50 }}` hardcoded across 6 chart components

**Files:** `DelayTrendChart.tsx`, `BunchingGapTrendChart.tsx`, `SystemHealthTimeline.tsx`, `TripCompletionChart.tsx`

The z-index value `50` is repeated across chart tooltips with inline `wrapperStyle` objects. Inline style objects create new object references each render and Recharts uses them directly. A shared `CHART_TOOLTIP_STYLE` constant object would prevent object churn and centralise any future z-index adjustments.

---

## Next Steps

1. (Critical) Replace manual `fetch + setInterval` in `StationDetailPage` with `useArrivals` hook — this is a single-file change.
2. (Critical) Lift `useDailyRollups` to the analytics page level and pass data as props to all chart components — eliminates 6+ redundant Apollo requests per page load.
3. (Critical) Move `ApolloProvider` down to the analytics route subtree — remove it from root layout.
4. (Important) Remove `watchId` from Zustand geolocation store state — use a module-level variable.
5. (Important) Add `multiArrivals` to the centralised `queryKeys` registry.
6. (Important) Replace `StationSearch` dropdown with shadcn `Command`/`Combobox` for proper a11y.
7. (Important) Add error reporting to `ErrorBoundary.componentDidCatch`.
8. (Important) Fix `AlertBanner` ticker resume-from-position on un-pause.
9. (Minor) Add `'use client'` to `use-mobile.ts`.
10. (Minor) Add `aria-hidden="true"` to the escalator SVG icon in `EquipmentStatusCard`.
11. (Minor) Clarify or remove `ConductorProvider>{null}</ConductorProvider>` in dashboard layout.
12. (Minor) Delete or document `useTrainPositionsSuspense` — currently dead code.
