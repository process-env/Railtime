# Map Components & Hooks Code Review

**Last Updated:** 2025-12-06

## Executive Summary

This review covers the map components, animation hooks, data fetching hooks, caching system, and recent performance optimizations in the traintracker application.

**Overall Assessment:** **NEEDS WORK** - The codebase has a solid foundation with React Query/Zustand integration, but significant architectural debt exists in the map animation layer. Critical test coverage gaps and a disabled state machine require immediate attention before shipping.

**Risk Level:** Medium-High
- Core functionality works but has fragile edge cases
- Animation system complexity creates maintenance burden
- Missing tests for 1,400+ lines of critical hook code

---

## Strengths

### 1. Clean State Management Architecture
- **React Query for server state** - Trains, alerts, static data correctly managed
- **Zustand for UI state** - Theme, selections, sidebar state properly isolated
- **Good separation** - Server state never duplicated in Zustand (alerts-store only tracks dismissed IDs)

### 2. Smart Caching Strategy
- Prefetch on hover for instant navigation (`usePrefetchMap`, `usePrefetchAnalytics`)
- Background sync keeps data warm on non-map pages (`useBackgroundSync`)
- Extended gcTime (30 min) preserves cache across navigation
- Static data cached with `staleTime: Infinity`

### 3. Performance Optimizations
- Module-level `TERMINAL_STOPS` constant avoids Set recreation
- Cached element references in station markers prevent DOM queries
- Phase polling reduced from 100ms to 500ms (80% fewer re-renders)
- Duration matrix load guard prevents duplicate async loads

### 4. Solid Hook Composition
- Map functionality cleanly split across `useMapAnimation`, `useTrainMarkers`, `useStationMarkers`
- Each hook has focused responsibility
- Options patterns allow configuration

### 5. Good UI/UX Patterns
- Loading overlay shows until map AND data ready
- Distance-based phase detection synced between popup and detail panel
- Route filtering immediately removes non-matching trains

---

## Issues & Findings

### Correctness / Bugs

#### CRITICAL: State Machine Disabled (useTrainMarkers:482)
```typescript
// DISABLED: State machine causes trains to get stuck in BOARDING phase
const animState = null;
```
- Complex boarding phase logic deliberately disabled
- No unit tests documenting the root cause
- Fallback lerp logic substitutes without clear documentation
- **Risk:** Trains could display wrong phase or get stuck

#### HIGH: Async State Updates Race Conditions (useTrainMarkers:272-381)
```typescript
filteredTrains.forEach(async (train) => {
  // Multiple async operations without error handling
  const track = await getRouteTrack(train.routeId);
  const prevS = await getStopArclength(...);
  // No AbortController, no try-catch
});
```
- Orphaned promises with no tracking
- No error handling for `getRouteTrack`/`getStopArclength` failures
- **Risk:** Trains disappear from map silently

#### MEDIUM: Dynamic Module Loading Race (useMapAnimation:119-156)
- Motion utilities loaded asynchronously on mount
- Animation could fail if modules don't load in time
- No loading state or retry logic
- **Risk:** Animation breaks on slow connections

### Design & Architecture

#### HIGH: Dual Animation System Complexity
Two competing animation systems run in parallel:
1. Legacy `trainAnimsRef` (lerp-based)
2. New `trainMotionRef` (α-β-γ filter-based)

Both updated every frame (lines 259-274 and 276-380), increasing:
- CPU usage
- Code complexity
- Bug surface area

No clear deprecation path documented.

#### HIGH: Massive Function Size (useTrainMarkers: 794 lines)
- `useTrainMarkers()` hook: 157 lines
- `createMotionState()`: 130 lines
- `updateMotionState()`: 90 lines
- `createPopupHTML()`: 70 lines

Too complex to test, maintain, or reason about.

#### MEDIUM: trains-store.ts Likely Dead Code
```typescript
// Note: Arrivals are now fetched via React Query (use-arrivals.ts),
// not stored in Zustand.
```
- Store exists but React Query owns train data
- `updateTrains()` probably never called
- No migration documentation

### Maintainability & Readability

#### MEDIUM: Hard-coded Magic Numbers
| Constant | Value | Location |
|----------|-------|----------|
| REFRESH_INTERVAL | 15000ms | SubwayMap.tsx:16 |
| CULL_GRACE_PERIOD_MS | 300000ms | useTrainMarkers.ts:113 |
| ARRIVING_DISTANCE | 200m | useMapAnimation.ts:107 |
| STATION_SNAP_DISTANCE | 20m | useMapAnimation.ts:108 |
| Phase polling | 500ms | SubwayMap.tsx:211 |

No configuration file, no documentation for why these values.

#### MEDIUM: Terminal Stops Heuristic
```typescript
const TERMINAL_STOPS = new Set([
  '101', '101N', '101S', // Van Cortlandt Park-242 St
  // ... 30+ more hard-coded stop IDs
]);
```
- Incomplete list (only major terminals)
- Used for grace period logic
- If detection fails, trains stay visible too long

#### LOW: Phase Colors Duplicated
Phase indicator colors defined in multiple places:
- `TrainDetailPanel.tsx:68-72`
- `useTrainMarkers.ts:762-763`
- `useMapAnimation.ts` (createPopupHTMLForAnimation)

Should extract to shared constants.

### Performance & Scalability

#### MEDIUM: Grace Period Logic
- Trains stay visible 5 minutes after API removes them
- Combined with terminal detection issues, stale trains could persist indefinitely
- No per-train timeout cleanup

#### MEDIUM: Duplicate Alerts Polling
- `useBackgroundSync` polls alerts every 60s
- `useAlerts` also has refetchInterval
- No coordination between them

#### LOW: Zoom-Based Station Culling
- Stations hidden at low zoom (< STATION_MIN_ZOOM)
- No performance metrics justify this
- Sudden visibility toggle at zoom boundary

### Testing & Coverage

#### CRITICAL: No Tests for Map Hooks
| File | Lines | Tests |
|------|-------|-------|
| useMapAnimation.ts | 424 | **NONE** |
| useTrainMarkers.ts | 794 | **NONE** |
| useStationMarkers.ts | 201 | **NONE** |
| SubwayMap.tsx | 279 | **NONE** |
| TrainDetailPanel.tsx | 108 | **NONE** |

**1,800+ lines of critical code with zero test coverage.**

#### MEDIUM: Gaps in Existing Tests
- `use-alerts.test.ts` doesn't test active period filtering logic
- `trains-store.test.ts` tests potentially dead code
- No integration tests for prefetch → navigation flow

---

## Recommendations

### Priority 1: Critical (Do Immediately)

1. **Add Test Coverage for Map Hooks**
   - Write unit tests for useMapAnimation phase transitions
   - Test useTrainMarkers marker lifecycle
   - Test useStationMarkers selection state
   - Add integration test for full map flow

2. **Fix or Document State Machine Issue**
   - Investigate why boarding phase gets stuck
   - Either fix root cause or document workaround
   - Add regression test

3. **Add Error Handling for Async Operations**
   - Wrap `getRouteTrack`/`getStopArclength` in try-catch
   - Show user-friendly error when track data fails
   - Add AbortController for cleanup

### Priority 2: High (This Sprint)

4. **Refactor useTrainMarkers**
   - Split into smaller, focused functions
   - Extract marker creation to separate module
   - Add proper TypeScript types for all params

5. **Consolidate Animation Systems**
   - Choose between legacy lerp and α-β-γ filter
   - Remove unused system
   - Document decision

6. **Coordinate Background Sync**
   - Remove duplicate alerts polling
   - Add page visibility API check
   - Ensure stale times match

### Priority 3: Medium (Next Sprint)

7. **Extract Constants to Configuration**
   - Create `map-constants.ts` for all magic numbers
   - Document rationale for each value
   - Consider environment-based configuration

8. **Clean Up Dead Code**
   - Verify trains-store is unused
   - Remove or deprecate with documentation
   - Update tests accordingly

9. **Improve Error UX**
   - Add error boundary for map components
   - Display user-friendly messages
   - Add retry buttons where appropriate

### Priority 4: Low (Backlog)

10. **Extract Phase Colors to Theme**
11. **Add loading states for dynamic imports**
12. **Document animation system architecture**

---

## Testing & Coverage Recommendations

### New Test Files Needed

```
src/components/map/__tests__/
├── SubwayMap.test.tsx
├── TrainDetailPanel.test.tsx
└── hooks/
    ├── useMapAnimation.test.ts
    ├── useTrainMarkers.test.ts
    └── useStationMarkers.test.ts
```

### Key Test Scenarios

**useMapAnimation:**
- Phase transition: APPROACHING → ARRIVING → BOARDING
- Dwell time at stations
- Animation frame cleanup on unmount
- Dynamic module loading failure

**useTrainMarkers:**
- Marker creation for new train
- Marker removal when train filtered out
- Grace period for disappeared trains
- Terminal detection accuracy

**useStationMarkers:**
- Selection state visual updates
- Arrival indicator animation
- Zoom-based visibility toggle
- Event listener cleanup

**Integration:**
- Prefetch on hover → instant map load
- Filter selection → marker removal
- Train selection → detail panel sync

---

## Consistency with Standards

### Deviations Found

1. **No JSDoc on complex functions** - useTrainMarkers helpers lack documentation
2. **Inconsistent error handling** - Some async uses try-catch, some don't
3. **Mixed naming** - `trainAnimsRef` vs `trainMotionRef` (legacy vs new)
4. **No TypeScript strict mode issues** - But type assertions (`as`) hide problems

### Recommended Standards

1. Add JSDoc to all exported functions
2. Use `unknown` instead of `any` for dynamic imports
3. Prefer early returns over nested conditionals
4. Document all magic numbers inline

---

## Overall Assessment

| Category | Score | Notes |
|----------|-------|-------|
| Functionality | 7/10 | Works but edge cases fragile |
| Code Quality | 5/10 | Large functions, missing tests |
| Performance | 8/10 | Good optimizations applied |
| Maintainability | 4/10 | Complex, undocumented |
| Test Coverage | 3/10 | Critical gaps |
| **Overall** | **5.4/10** | Needs significant work |

**Verdict:** Not ready for production release without addressing critical test coverage gaps and documenting/fixing the disabled state machine.
