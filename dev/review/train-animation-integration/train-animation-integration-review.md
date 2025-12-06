# Train Animation Integration - Code Review

**Last Updated: 2025-12-06**

## Executive Summary

**Status: NEEDS WORK - Critical architectural issues causing zig-zag behavior**

The train animation system has a **dual-system conflict** where both the state machine AND legacy code update train positions, creating race conditions that cause zig-zag behavior. The state machine logic is sound, but its integration with `useTrainMarkers.ts` undermines it.

**Key Finding**: The state machine controls `animState.currentS`, but `useTrainMarkers.ts` also directly modifies `state.filter.s` and `state.prevS/nextS` on segment changes. The animation loop reads from state machine, but the data gets corrupted by parallel updates.

---

## Strengths

1. **State machine design is solid** (`train-state-machine.ts`)
   - Clean reducer pattern
   - Distance-based phase detection (not percentage-based)
   - Proper dwell/pending segment handling
   - Well-bounded speed multiplier (0.5-2.0)

2. **Good test coverage with real GTFS data**
   - `real-data.test.ts` uses actual stops.txt and geojson
   - Tests validate phase transitions at correct distances

3. **Clear separation of concerns in theory**
   - State machine handles timing logic
   - Animation hook handles rendering
   - Markers hook handles API data

---

## Issues & Findings

### CRITICAL - Correctness / Bugs

#### Issue 1: Dual Position Update Conflict (ROOT CAUSE OF ZIG-ZAG)

**Location**: `useTrainMarkers.ts:539-552` and `useMapAnimation.ts:202-219`

**Problem**: Both systems update position on segment change:

```typescript
// useTrainMarkers.ts:542-547 - LEGACY UPDATE
if (segmentChanged && prevS !== undefined) {
  const newS = prevS + (nextS - prevS) * apiProgress;
  state.filter.s = newS;  // <-- Directly modifies filter
  state.filter.v = 0;
  state.filter.a = 0;
  state.prevS = prevS;    // <-- Updates arclength bounds
  state.nextS = nextS;
}

// useMapAnimation.ts:204-213 - STATE MACHINE UPDATE
if (state.animState) {
  state.animState = trainAnimationReducer(state.animState, { type: 'TICK', nowMs });
  const currentS = getCurrentArclength(state.animState);
  state.filter.s = currentS;  // <-- Overwrites filter.s
}
```

**Impact**: On every segment change:
1. `useTrainMarkers` dispatches `API_UPDATE` to state machine (correct)
2. Then ALSO directly modifies `state.filter.s` and arclength bounds (WRONG)
3. Animation loop reads from state machine, but state machine may have stale bounds
4. Result: Position jumps back and forth = zig-zag

**Severity**: CRITICAL
**Effort**: M

---

#### Issue 2: State Machine Not Authoritative for Arclength Bounds

**Location**: `useTrainMarkers.ts:549-551`

**Problem**: The state machine stores `prevS/nextS` internally, but `useTrainMarkers` also stores them in `TrainMotionState`. When segment changes, both get updated separately:

```typescript
// State machine has its own prevS/nextS
state.animState = { prevS, nextS, currentS, ... }

// TrainMotionState ALSO has prevS/nextS
state.prevS = prevS;  // Duplicate!
state.nextS = nextS;  // Duplicate!
```

**Impact**: Two sources of truth. If they diverge, animation breaks.

**Severity**: HIGH
**Effort**: M

---

#### Issue 3: Triple Dispatch Per API Update

**Location**: `useTrainMarkers.ts:275-287`

**Problem**: Three separate dispatches per API cycle:

```typescript
existingMotion.animState = trainAnimationReducer(existingMotion.animState, {
  type: 'SET_DURATION', duration: scheduledDuration
});
existingMotion.animState = trainAnimationReducer(existingMotion.animState, {
  type: 'SET_SPEED_MULTIPLIER', multiplier: speedMultiplier
});
// Then later in updateMotionState():
state.animState = trainAnimationReducer(state.animState, {
  type: 'API_UPDATE', ...
});
```

**Impact**:
- Inefficient (3 state transitions instead of 1)
- Risk of partial state updates
- Makes debugging harder

**Severity**: MEDIUM
**Effort**: S

---

### Design & Architecture

#### Issue 4: Filter State is Redundant

**Location**: `useMapAnimation.ts:29-31`, `useTrainMarkers.ts:473`

**Problem**: `FilterState` with `s, v, a` is a remnant of alpha-beta-gamma filtering. Now it's just used as a container for `s`, with `v` and `a` always reset to 0.

```typescript
filter: createFilterState(initialS, 0, 0, nowMs),  // v=0, a=0 always
```

**Impact**: Confusing code, unnecessary complexity.

**Severity**: LOW
**Effort**: S

---

#### Issue 5: Legacy Animation System Still Active

**Location**: `useMapAnimation.ts:62-76`, `useTrainMarkers.ts:568-632`

**Problem**: Legacy `TrainAnimState` system and `createLegacyMarker()` still exist and can be activated. Two animation systems coexist.

**Impact**:
- Confusion about which system is used
- Potential for trains to use different systems
- Dead code maintenance burden

**Severity**: MEDIUM
**Effort**: M

---

### Maintainability & Readability

#### Issue 6: Documentation Mismatch

**Location**: `train-state-machine.ts:7-11`

**Problem**: Doc comment says "AT_STATION" and "DEPARTING" but type only has "BOARDING":

```typescript
// Doc says:
 * - AT_STATION: Train snapped to exact station position
 * - DEPARTING: Train just left station

// Type says:
export type TrainPhase = 'APPROACHING' | 'ARRIVING' | 'BOARDING';
```

**Severity**: LOW
**Effort**: S

---

#### Issue 7: Module-Level Mutable State

**Location**: `useTrainMarkers.ts:50-56`, `useMapAnimation.ts:91-97`

**Problem**: Dynamic imports stored in module-level `let` variables:

```typescript
let getRouteTrack: (...) | null = null;
let trainAnimationReducer: any = null;
```

**Impact**:
- SSR concerns
- Type safety loss (`any`)
- Global mutable state

**Severity**: MEDIUM
**Effort**: M

---

## Recommendations

### Priority 1: Fix Dual Update Conflict (CRITICAL)

**Remove legacy position updates from `useTrainMarkers.ts`**

The state machine should be the ONLY source of truth for position. Remove lines 539-552:

```typescript
// REMOVE THIS BLOCK:
if (segmentChanged && prevS !== undefined) {
  const newS = prevS + (nextS - prevS) * apiProgress;
  state.filter.s = newS;
  state.filter.v = 0;
  state.filter.a = 0;
  state.prevS = prevS;
  state.nextS = nextS;
}
```

The state machine's `API_UPDATE` handler already handles segment changes correctly.

---

### Priority 2: Make State Machine Authoritative

**Remove duplicate `prevS/nextS` from `TrainMotionState`**

Either:
- A) Remove `prevS/nextS` from `TrainMotionState`, read from `animState` only
- B) Sync them FROM state machine, not independently

---

### Priority 3: Consolidate Dispatches

**Add duration/speed to `API_UPDATE` action**

```typescript
// train-state-machine.ts
export type TrainAction =
  | { type: 'API_UPDATE'; nowMs: number; prevStopId: string; nextStopId: string;
      prevS: number; nextS: number; apiProgress: number;
      duration?: number; speedMultiplier?: number }  // Add these
```

---

### Priority 4: Remove Legacy System

After fix is verified working, remove:
- `TrainAnimState` interface
- `trainAnimsRef`
- `createLegacyMarker()`
- Legacy animation branch in `animateTrains()`

---

## Testing & Coverage

### Current Coverage
- `train-state-machine.test.ts`: Unit tests with mock data
- `real-data.test.ts`: Integration tests with GTFS data
- Speed multiplier bounds test: Added

### Gaps
1. **No integration test for useTrainMarkers + useMapAnimation**
   - The zig-zag bug is in the integration, not individual units
2. **No test for segment change during animation**
3. **No test for API update frequency scenarios**

### Suggested Tests
1. Test that segment change only updates state machine, not filter directly
2. Test that 100 rapid API updates don't cause position oscillation
3. Test that position monotonically increases (for same-direction travel)

---

## Consistency with Standards

1. **TypeScript**: Using `any` for dynamically imported modules violates type safety
2. **React patterns**: Module-level state (`let` variables) is anti-pattern
3. **Single source of truth**: Violated by duplicate `prevS/nextS` storage

---

## Overall Assessment

The state machine itself is well-designed. The problem is the **integration layer** in `useTrainMarkers.ts` that bypasses the state machine and directly manipulates position state.

**Fix priority**:
1. Remove direct filter/arclength updates in `updateMotionState()`
2. Let state machine be the single source of truth
3. Then clean up legacy code

**Risk**: Medium - the fix is surgical but touches critical animation path. Test thoroughly.
