# Handoff Notes - Session 2025-12-06 (Latest)

**Date:** 2025-12-06
**Status:** CODE REVIEW COMPLETE

## What Was Completed This Session

### 1. Bug Fixes Applied
| Issue | Fix | File |
|-------|-----|------|
| Route filter not removing trains | Check if route matches filter, remove immediately if not | `useTrainMarkers.ts` |
| Station dots disappearing on filter | Always show all parent stations regardless of filter | `useStationMarkers.ts` |
| Detail panel phase not syncing with popup | Added 500ms polling for phase updates | `SubwayMap.tsx` |
| Ticker text off-center | Added `flex items-center` | `AlertBanner.tsx` |
| Station cards not showing train states | Added at station/arriving/en route display | `StationCard.tsx`, `stations/page.tsx` |

### 2. Performance Optimizations
| Optimization | Before | After | File |
|--------------|--------|-------|------|
| Phase polling interval | 100ms | 500ms (80% fewer re-renders) | `SubwayMap.tsx:218` |
| TERMINAL_STOPS | Recreated every render | Module-level constant | `useTrainMarkers.ts:1-20` |
| Station marker elements | DOM query each update | Cached in MarkerData | `useStationMarkers.ts` |
| Duration matrix loading | Could load multiple times | Guard with ref | `SubwayMap.tsx:46-62` |

### 3. Caching System Implemented
| Component | Purpose | File |
|-----------|---------|------|
| Extended gcTime | 30 minutes (was 10) | `query-client.ts` |
| useBackgroundSync | Refresh trains every 30s when not on map | `use-background-sync.ts` (NEW) |
| usePrefetchMap | Prefetch trains/alerts on hover | `use-prefetch-map.ts` (NEW) |
| Prefetch on hover | AppSidebar map link | `AppSidebar.tsx:99-100` |

### 4. Code Review Completed
Created comprehensive review documentation:

| File | Content |
|------|---------|
| `dev/review/map-components-2024-12/map-components-review.md` | Full review with findings, scores |
| `dev/review/map-components-2024-12/map-components-context.md` | Architecture, scope, data flow |
| `dev/review/map-components-2024-12/map-components-tasks.md` | Actionable checklist with priorities |

**Overall Score: 5.4/10** - Needs significant work

## Critical Issues Found in Review

### 1. Zero Test Coverage (CRITICAL)
- 1,800+ lines of map hook code with NO tests
- Files: useMapAnimation.ts (424 lines), useTrainMarkers.ts (794 lines), useStationMarkers.ts (201 lines)

### 2. State Machine Disabled (CRITICAL)
- Location: `useTrainMarkers.ts:482`
- Code: `const animState = null;`
- Boarding phase logic deliberately disabled with no documentation

### 3. Dual Animation Systems (HIGH)
- Legacy `trainAnimsRef` (lerp-based)
- New `trainMotionRef` (α-β-γ filter-based)
- Both run every frame - no deprecation plan

### 4. Async Race Conditions (HIGH)
- `getRouteTrack`/`getStopArclength` calls lack error handling
- No AbortController for cleanup
- Trains can silently disappear from map

## Files Modified This Session

```
src/components/map/hooks/useTrainMarkers.ts - Filter logic, module-level constants
src/components/map/hooks/useStationMarkers.ts - Station filtering, element caching
src/components/map/SubwayMap.tsx - Phase polling, loading overlay, matrix guard
src/components/map/TrainDetailPanel.tsx - Phase prop
src/components/stations/StationCard.tsx - Train states display
src/app/stations/page.tsx - Train states calculation
src/components/layout/AlertBanner.tsx - Ticker centering
src/components/layout/AppSidebar.tsx - Scrollbar class, prefetch hooks
src/lib/query-client.ts - Extended gcTime
src/hooks/use-background-sync.ts - NEW
src/hooks/use-prefetch-map.ts - NEW
src/hooks/use-train-positions-suspense.ts - NEW (unused, for future)
src/hooks/index.ts - Exports
dev/review/map-components-2024-12/* - NEW review docs
```

## Current State

- Dev server: Running at http://localhost:3000
- Build: Should pass (no breaking changes)
- All fixes working as expected

## Commands

```bash
# Start dev server
cd C:/Users/User/Documents/RND/_dev_/TS/traintracker
npm run dev

# Run tests
npx vitest run

# Build check
npm run build
```

## Previous Train Animation Issue

The previous handoff notes (`dev/active/handoff-notes.md`) document ongoing train animation zig-zag issues. Those are SEPARATE from this session's work. The root cause was identified:

- Dual position updates: state machine AND legacy code both modify `filter.s`
- Fix needed: Remove lines 539-552 in `useTrainMarkers.ts`
- Status: Not yet applied

## Next Recommended Steps

1. **Immediate:** Apply train animation fix (remove dual update)
2. **Priority 1:** Add test coverage for map hooks
3. **Priority 2:** Refactor useTrainMarkers (794 lines → smaller modules)
4. **Priority 3:** Consolidate animation systems

## Key Patterns Established

### Distance-Based Phase Detection
```typescript
// Thresholds from train-state-machine.ts
STATION_SNAP_DISTANCE = 20    // meters → BOARDING
ARRIVING_DISTANCE = 200       // meters → ARRIVING
// Otherwise → APPROACHING
```

### Route Filter Logic
```typescript
// In useTrainMarkers.ts
const routeFilterActive = selectedRouteIds.length > 0;
const trainRouteMatchesFilter = selectedRouteIds.includes(state.routeId?.toUpperCase() || '');
const isFilteredOut = routeFilterActive && !trainRouteMatchesFilter;

if (isFilteredOut) {
  // Remove immediately - no grace period
  state.popup.remove();
  state.marker.remove();
  trainMotionRef.current.delete(tripId);
} else {
  // Apply grace period for API-removed trains
}
```

### Prefetch on Hover Pattern
```typescript
// In AppSidebar.tsx
<Link
  href={item.href}
  onMouseEnter={prefetchFn}
  onFocus={prefetchFn}
>
```
