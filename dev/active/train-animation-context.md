# Train Animation System - Implementation Context

**Last Updated**: 2025-12-06T18:00:00Z
**Status**: ROOT CAUSE IDENTIFIED - DUAL UPDATE CONFLICT

## Problem Statement

Trains exhibit "zig-zag" behavior - they jump forward, backward, then forward again instead of smooth continuous motion toward stations.

## Root Cause (FINAL)

**Dual position updates causing conflict:**

```
INTENDED FLOW:
API → useTrainMarkers (dispatch API_UPDATE) → State Machine → Animation Loop → Marker

ACTUAL (BROKEN):
API → useTrainMarkers → Dispatch API_UPDATE → State Machine
                     ↓
         ALSO directly modifies filter.s, prevS, nextS  ← CONFLICT!
                     ↓
Animation Loop reads state machine but bounds corrupted → ZIG-ZAG
```

**Location of Root Cause:** `useTrainMarkers.ts:539-552`

```typescript
// THIS BLOCK CAUSES ZIG-ZAG - NEEDS TO BE REMOVED:
if (segmentChanged && prevS !== undefined) {
  const newS = prevS + (nextS - prevS) * apiProgress;
  state.filter.s = newS;
  state.filter.v = 0;
  state.filter.a = 0;
  state.prevS = prevS;
  state.nextS = nextS;
}
```

## Fixes Applied This Session (Separate from zig-zag)

1. **Speed multiplier compounding** - Fixed at `train-state-machine.ts:319`
   - Changed `state.speedMultiplier * adjustment` to bounded version
   - Test added: `train-state-machine.test.ts`

## Architecture Overview

### Animation Systems (Dual - needs consolidation)

| System | Reference | Purpose |
|--------|-----------|---------|
| Legacy | `trainAnimsRef` | Simple lerp interpolation |
| New | `trainMotionRef` | α-β-γ filter + state machine |

Both run every frame - should consolidate.

### State Machine Phases
```
APPROACHING (en route) → ARRIVING (within 200m) → BOARDING (at station) → next segment
```

### Distance Thresholds
```typescript
STATION_SNAP_DISTANCE = 20    // meters → BOARDING
ARRIVING_DISTANCE = 200       // meters → ARRIVING
// Otherwise → APPROACHING
```

### Duration Matrix
- File: `src/lib/map/route-durations.ts`
- Built from GTFS `stop_times.txt`
- Pre-computes travel time between consecutive stops

## Key Files

| File | Lines | Status |
|------|-------|--------|
| `useTrainMarkers.ts` | 794 | Contains root cause at lines 539-552 |
| `useMapAnimation.ts` | 424 | Animation loop - reads state machine |
| `train-state-machine.ts` | ~200 | State machine - works correctly |
| `route-durations.ts` | ~200 | Duration lookup - works correctly |

## Test Commands

```bash
# Run state machine tests
npx vitest run src/lib/map/train-state-machine.test.ts

# Run all tests
npx vitest run

# Build check
npm run build
```

## What's NOT Done

1. **Remove dual update block** (lines 539-552) - NOT APPLIED
2. **Test in browser** - Need to watch for 5+ minutes after fix
3. **Consolidate animation systems** - Future cleanup

## Code Review Completed

Full review at `dev/review/map-components-2024-12/`:
- Overall score: 5.4/10
- Critical issues: Zero test coverage, disabled state machine
- 16+ tasks documented in tasks.md

## Data Flow

```
STATIC (load once):
  stop_times.txt + trips.txt → Route Duration Matrix
  Map<routeId, Map<fromStopId, Map<toStopId, durationSeconds>>>

DYNAMIC (live):
  /api/v1/trains → current segment (prevStopId, nextStopId)
  /api/v1/alerts → delay/suspension info per route

ANIMATION:
  1. duration = matrix[routeId][prevStop][nextStop]
  2. speedMult = scheduledDuration / apiDuration
  3. adjustedDuration = duration / speedMult
  4. progress = elapsed / adjustedDuration
  5. if (progress >= 1.0) SNAP to station else lerp
```
