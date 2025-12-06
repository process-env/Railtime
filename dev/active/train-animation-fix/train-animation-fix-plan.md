# Train Animation Fix - Comprehensive Plan

**Last Updated: 2025-12-06**

## Executive Summary

Train animations exhibit "zig-zag" behavior and fail to properly reach stations. Root cause analysis revealed two issues:
1. ~~Undefined constants~~ (FIXED)
2. **Speed multiplier compounding bug** (NOT FIXED - Critical)

This plan outlines the complete fix, testing strategy, and cleanup tasks.

---

## Current State Analysis

### Problem Symptoms
- Trains "zig-zag" back and forth instead of moving smoothly
- Trains never properly "arrive" at stations
- ETA display shows static "1 min"
- Animation becomes increasingly erratic over time

### Root Cause
The state machine's sync mechanism compounds speed multiplier on each API update:

```typescript
// train-state-machine.ts:315
speedMultiplier: state.speedMultiplier * adjustment  // COMPOUNDS!
```

After 10 API updates (every 15s = 2.5 minutes), if adjustment is 1.1:
- `1.0 * 1.1 * 1.1 * ... = 2.59x` original speed

### System Architecture
```
GTFS-realtime API (every 15s)
         ↓
train-positions.ts (calculates lat/lon, progress)
         ↓
useTrainMarkers.ts (converts to arclength, creates markers)
         ↓
train-state-machine.ts (reducer for animation state)
         ↓
useMapAnimation.ts (requestAnimationFrame loop)
         ↓
MapLibre marker.setLngLat()
```

---

## Proposed Future State

### Goals
1. Trains move smoothly between stations
2. Trains properly "snap" to station when within 20m
3. Speed stays bounded (0.5x - 2.0x normal)
4. Phase transitions (APPROACHING → ARRIVING → BOARDING) work correctly
5. Tests verify behavior with real GTFS data

### Success Criteria
- [ ] No zig-zag behavior observed
- [ ] Trains visually stop at station dots
- [ ] Popup shows correct phase (Boarding/Arriving/En Route)
- [ ] All tests pass with real data
- [ ] Speed multiplier stays within bounds after 100 API updates

---

## Implementation Phases

### Phase 1: Critical Bug Fix (Effort: S)

**Objective:** Fix the speed multiplier compounding bug

#### Task 1.1: Fix Speed Multiplier
- **File:** `src/lib/map/train-state-machine.ts`
- **Line:** 315-322
- **Change:**
```typescript
// FROM:
speedMultiplier: state.speedMultiplier * adjustment,

// TO:
speedMultiplier: Math.max(0.5, Math.min(2.0, adjustment)),
```
- **Acceptance Criteria:**
  - Speed multiplier is directly set, not multiplied
  - Value is bounded between 0.5 and 2.0
  - No change to other sync logic

#### Task 1.2: Add Speed Bounds Test
- **File:** `src/lib/map/train-state-machine.test.ts`
- **Test:**
```typescript
it('should not compound speed multiplier on repeated API updates', () => {
  let state = createTrainAnimationState(...);
  for (let i = 0; i < 100; i++) {
    state = trainAnimationReducer(state, { type: 'API_UPDATE', ... });
  }
  expect(state.speedMultiplier).toBeGreaterThanOrEqual(0.5);
  expect(state.speedMultiplier).toBeLessThanOrEqual(2.0);
});
```
- **Acceptance Criteria:** Test passes

---

### Phase 2: Verification (Effort: S)

**Objective:** Verify fix with real data

#### Task 2.1: Run Real Data Test
- **Command:** `npx vitest run src/lib/map/real-data.test.ts`
- **Verify:**
  - CSV output shows smooth progression
  - Phase transitions at correct distances
  - No anomalies in output

#### Task 2.2: Browser Testing
- **Steps:**
  1. Kill existing dev servers: `taskkill //F //IM node.exe`
  2. Start fresh: `npm run dev`
  3. Open browser, watch trains for 5+ minutes
  4. Click trains to see popup phases
- **Acceptance Criteria:**
  - Trains move smoothly
  - Trains stop at station dots
  - Popup shows "Boarding" when at station

---

### Phase 3: Code Cleanup (Effort: M)

**Objective:** Remove technical debt discovered during review

#### Task 3.1: Consolidate State Updates
- **File:** `src/components/map/hooks/useTrainMarkers.ts`
- **Issue:** 3 separate reducer dispatches per API cycle
- **Fix:** Add duration/speed to API_UPDATE action
- **Effort:** M
- **Dependencies:** Phase 1 complete

#### Task 3.2: Remove Legacy Animation System
- **Files:**
  - `useMapAnimation.ts`
  - `useTrainMarkers.ts`
- **Remove:**
  - `TrainAnimState` interface
  - `trainAnimsRef`
  - `createLegacyMarker()`
  - Legacy animation branch in `animateTrains()`
- **Effort:** L
- **Dependencies:** Verify all routes work with new system

#### Task 3.3: Update Documentation
- **File:** `src/lib/map/train-state-machine.ts:7-11`
- **Issue:** Comments mention AT_STATION/DEPARTING but type has BOARDING
- **Fix:** Update comments to match implementation
- **Effort:** S

#### Task 3.4: Remove Dead Code
- **Files:** `useMapAnimation.ts`
- **Remove:**
  - `plan: MotionPlan | null` field
  - `evaluatePlan` import
  - Unused `TrainAnimationState` import
- **Effort:** S

---

### Phase 4: Enhanced Testing (Effort: M)

**Objective:** Comprehensive test coverage

#### Task 4.1: Add Edge Case Tests
- Segment change while BOARDING (pending segment flow)
- Large sync discrepancy (>30% snap)
- Zero-length segment (prevS === nextS)
- Negative segment (train going backwards)

#### Task 4.2: Optimize Test File Loading
- **File:** `src/lib/map/real-data.test.ts`
- **Change:** Use `beforeAll` to load files once
- **Effort:** S

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fix breaks other functionality | Low | High | Run full test suite before/after |
| Legacy system needed for some routes | Medium | Medium | Keep legacy code until verified |
| Browser behavior differs from tests | Low | Medium | Manual testing in multiple browsers |

---

## Success Metrics

1. **Functional:** Trains reach stations without zig-zag
2. **Performance:** Animation runs at 60fps
3. **Stability:** Speed multiplier bounded (0.5-2.0)
4. **Coverage:** All new tests pass

---

## Required Resources

### Files to Modify
| File | Priority | Effort |
|------|----------|--------|
| `src/lib/map/train-state-machine.ts` | Critical | S |
| `src/lib/map/train-state-machine.test.ts` | High | S |
| `src/components/map/hooks/useTrainMarkers.ts` | Medium | M |
| `src/components/map/hooks/useMapAnimation.ts` | Low | M |

### Test Data
- `public/data/stops.txt` - Real MTA stop data
- `public/map/nyc-subway-lines.geojson` - Real track geometry

---

## Timeline Estimates

| Phase | Tasks | Effort | Status |
|-------|-------|--------|--------|
| Phase 1 | 1.1, 1.2 | 30 min | Not Started |
| Phase 2 | 2.1, 2.2 | 15 min | Not Started |
| Phase 3 | 3.1-3.4 | 2-3 hr | Not Started |
| Phase 4 | 4.1, 4.2 | 1 hr | Not Started |

**Total Estimate:** 4-5 hours

---

## Related Documentation

- Code Review: `dev/review/train-animation-state-machine/`
- Handoff Notes: `dev/HANDOFF.md`
- Original Plan: `C:\Users\User\.claude\plans\nested-plotting-aho.md`
