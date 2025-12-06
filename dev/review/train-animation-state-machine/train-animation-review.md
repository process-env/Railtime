# Train Animation State Machine - Code Review

**Last Updated: 2025-12-06**

## Executive Summary

The train animation system uses a well-structured state machine pattern with distance-based phase detection. The core logic is sound, but there are several issues that could cause the "zig-zag" behavior and trains not reaching stations properly.

**Overall Assessment: 6/10 - Needs Work**

The state machine logic itself is correct, but integration issues between the state machine and the hooks that consume it create synchronization problems.

---

## Strengths

### 1. Clean State Machine Pattern
- Uses reducer pattern for predictable state updates
- Clear phase transitions: APPROACHING → ARRIVING → BOARDING
- Distance-based thresholds (not percentage) ensure consistent behavior

### 2. Distance-Based Phase Detection
```typescript
const ARRIVING_DISTANCE = 200;       // meters
const STATION_SNAP_DISTANCE = 20;    // meters
```
Using absolute distances (not percentages) means trains behave consistently regardless of segment length.

### 3. Pending Segment Caching
The state machine correctly caches API updates while dwelling:
```typescript
if (state.phase === 'BOARDING') {
  return { ...state, pendingSegment: { ... } };
}
```
This prevents interrupting the dwell animation.

### 4. Good Test Coverage Foundation
The `real-data.test.ts` uses actual GTFS data from `stops.txt` and GeoJSON, not mock data.

---

## Issues & Findings

### CRITICAL: Correctness / Bugs

#### 1. Documentation Mismatch (Lines 7-11)
**File:** `train-state-machine.ts`
```typescript
// Comment says:
* - AT_STATION: Train snapped to exact station position
* - DEPARTING: Train just left station, beginning new segment

// But actual type is:
export type TrainPhase = 'APPROACHING' | 'ARRIVING' | 'BOARDING';
```
**Impact:** Misleading documentation, no actual code bug.

#### 2. Speed Multiplier Accumulation Bug
**File:** `train-state-machine.ts:312-322`
```typescript
// When there's moderate discrepancy, speed multiplier is MULTIPLIED
return {
  ...state,
  speedMultiplier: state.speedMultiplier * adjustment,
};
```
**Impact:** Speed multiplier compounds over multiple API updates, causing trains to accelerate/decelerate erratically. Should be SET, not MULTIPLIED.

#### 3. Double State Update in useTrainMarkers
**File:** `useTrainMarkers.ts:274-287`
```typescript
// SET_DURATION dispatched
existingMotion.animState = trainAnimationReducer(existingMotion.animState, {
  type: 'SET_DURATION', duration: scheduledDuration
});
// Then SET_SPEED_MULTIPLIER dispatched
existingMotion.animState = trainAnimationReducer(existingMotion.animState, {
  type: 'SET_SPEED_MULTIPLIER', multiplier: speedMultiplier
});
// Then API_UPDATE in updateMotionState()
```
**Impact:** Three rapid state updates per API cycle. The duration/speed should be part of API_UPDATE action.

### HIGH: Design & Architecture

#### 4. Dual Animation Systems Running
**Files:** `useMapAnimation.ts`, `useTrainMarkers.ts`
Both legacy (`TrainAnimState`) and new (`TrainMotionState`) systems run simultaneously. The hooks maintain two separate Maps:
```typescript
const trainAnimsRef = useRef<Map<string, TrainAnimState>>(new Map());
const trainMotionRef = useRef<Map<string, TrainMotionState>>(new Map());
```
**Impact:** Resource waste, potential synchronization issues.

#### 5. Module-Level Mutable State
**File:** `useTrainMarkers.ts:49-56`
```typescript
let getRouteTrack: ((routeId: string) => Promise<RouteTrack | undefined>) | null = null;
let getStopArclength: ((routeId: string, stopId: string) => Promise<number | undefined>) | null = null;
let createFilterState: any = null;
// ... etc
```
**Impact:** Module-level mutable globals can cause issues in SSR/concurrent rendering.

#### 6. Hardcoded Default Duration
**Files:** Multiple locations
```typescript
scheduledDuration = 90; // Hardcoded fallback
```
**Impact:** 90 seconds may be way off for some segments (express stops vs local stops).

### MEDIUM: Maintainability & Readability

#### 7. Dead Code / Deprecated Fields
**File:** `useMapAnimation.ts:32-35`
```typescript
// Motion plan (deprecated, kept for compatibility)
plan: MotionPlan | null;
```
The `plan` field and `evaluatePlan` import are never used.

#### 8. Unused Import
**File:** `useMapAnimation.ts:17`
```typescript
import type { TrainAnimationState } from '@/lib/map/train-state-machine';
```
`TrainAnimationState` is imported but the type alias is never directly used.

#### 9. ROUTE_STOP_PREFIXES Not Used
**File:** `track-index.ts:149-174`
```typescript
const ROUTE_STOP_PREFIXES: Record<string, string[]> = { ... };
```
This mapping is defined but `routePrefixes` is never actually used in the logic.

### MEDIUM: Performance & Scalability

#### 10. Async in forEach Loop
**File:** `useTrainMarkers.ts:247`
```typescript
filteredTrains.forEach(async (train) => { ... });
```
**Impact:** Unhandled promise rejections, no parallelization control.

#### 11. Repeated File Reads in Tests
**File:** `real-data.test.ts`
Each test reads `stops.txt` and GeoJSON from disk separately. Should use `beforeAll` to load once.

### LOW: API Ergonomics

#### 12. Inconsistent Time Units
- `scheduledDuration`: seconds
- `segmentStartTime`: milliseconds
- `dwellDuration`: seconds
- `nowMs`: milliseconds

---

## Recommendations

### Priority 1: Fix Speed Multiplier Bug
Replace multiplication with direct set:
```typescript
if (discrepancy > SYNC_ADJUST_THRESHOLD) {
  const targetMultiplier = apiProgress > ourProgress ? 1.2 : 0.8;
  return {
    ...state,
    speedMultiplier: targetMultiplier, // SET, don't multiply
    lastApiUpdate: nowMs,
    apiProgress,
  };
}
```

### Priority 2: Consolidate State Updates
Add duration/speed to API_UPDATE action type:
```typescript
| { type: 'API_UPDATE'; nowMs: number; prevStopId: string; nextStopId: string;
    prevS: number; nextS: number; apiProgress: number;
    scheduledDuration?: number; speedMultiplier?: number }
```

### Priority 3: Remove Legacy System
If all routes work with new system, remove:
- `TrainAnimState` interface
- `trainAnimsRef`
- Legacy animation in `animateTrains()`
- `createLegacyMarker()`

### Priority 4: Fix Test Loading
Use `beforeAll` in tests:
```typescript
let stops: Map<string, ...>;
let geojson: any;

beforeAll(() => {
  stops = parseStops(fs.readFileSync(stopsPath, 'utf-8'));
  geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
});
```

---

## Testing & Coverage

### Current Coverage
- `train-state-machine.test.ts`: Basic unit tests with mock data
- `real-data.test.ts`: Integration tests with real GTFS data

### Missing Tests
1. **Speed multiplier accumulation** - No test verifies it doesn't compound
2. **Segment change while BOARDING** - Pending segment flow
3. **Large sync discrepancy (>30%)** - SNAP behavior
4. **Negative arclength segments** - Train going backwards (direction reversal)
5. **Edge case: prevS === nextS** - Zero-length segment

### Suggested Test Cases
```typescript
it('should not compound speed multiplier on repeated API updates', () => {
  let state = createTrainAnimationState(...);
  // Dispatch multiple API_UPDATE with small discrepancy
  for (let i = 0; i < 10; i++) {
    state = trainAnimationReducer(state, { type: 'API_UPDATE', ... });
  }
  // speedMultiplier should stay bounded (0.5 - 2.0)
  expect(state.speedMultiplier).toBeGreaterThan(0.5);
  expect(state.speedMultiplier).toBeLessThan(2.0);
});
```

---

## Consistency with Standards

### TypeScript
- Good use of discriminated unions for actions
- Type exports are properly defined
- Some `any` types in dynamic imports could be improved

### React Patterns
- Hooks follow naming conventions
- Refs used appropriately for mutable state
- Effect dependencies mostly correct

### Project Conventions
- File naming follows kebab-case
- Module organization is logical
- Comments are present but some are outdated

---

## Overall Assessment

The state machine core is well-designed. The main issues are:

1. **Integration bugs** between state machine and consuming hooks
2. **Speed multiplier compounding** causes erratic behavior
3. **Legacy/new system coexistence** adds complexity
4. **Test coverage gaps** for edge cases

**Recommendation:** Focus on fixing the speed multiplier bug first, as this is likely causing the "zig-zag" behavior. Then consolidate the dual animation systems.
