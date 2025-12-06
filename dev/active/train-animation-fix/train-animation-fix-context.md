# Train Animation Fix - Context Document

**Last Updated: 2025-12-06**

## Current Status

**ROOT CAUSE IDENTIFIED**: Dual position update conflict between state machine and legacy code.

## Key Files

### Core Implementation
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/map/train-state-machine.ts` | 376 | STATE MACHINE - Reducer pattern (CORRECT) |
| `src/components/map/hooks/useMapAnimation.ts` | 288 | Animation loop (CORRECT) |
| `src/components/map/hooks/useTrainMarkers.ts` | 678 | Marker creation - **HAS BUG AT 539-552** |

### Tests
| File | Purpose |
|------|---------|
| `src/lib/map/train-state-machine.test.ts` | Unit tests + speed multiplier bounds test |
| `src/lib/map/real-data.test.ts` | Integration tests with REAL GTFS data |

### Reviews
| File | Purpose |
|------|---------|
| `dev/review/train-animation-integration/` | Latest review with root cause |
| `dev/review/train-animation-state-machine/` | Earlier review |

---

## Root Cause Analysis

### The Problem
Trains zig-zag because TWO systems update position:

1. **State Machine** (via `API_UPDATE` dispatch) - CORRECT
2. **Legacy Code** (direct `state.filter.s` update) - WRONG

### The Conflict Location
```
File: src/components/map/hooks/useTrainMarkers.ts
Lines: 539-552
```

```typescript
// THIS BLOCK CONFLICTS WITH STATE MACHINE:
if (segmentChanged && prevS !== undefined) {
  const newS = prevS + (nextS - prevS) * apiProgress;
  state.filter.s = newS;      // <-- CONFLICT
  state.filter.v = 0;
  state.filter.a = 0;
  state.prevS = prevS;        // <-- CONFLICT
  state.nextS = nextS;        // <-- CONFLICT
}
```

### Why It Causes Zig-Zag
1. State machine stores `currentS`, `prevS`, `nextS` internally
2. Animation loop reads `currentS` from state machine
3. BUT legacy code overwrites `state.prevS/nextS` independently
4. State machine and TrainMotionState have different arclength bounds
5. Position calculation breaks → train jumps → zig-zag

---

## What Was Fixed This Session

### 1. Speed Multiplier Compounding (DONE)
- **File**: `src/lib/map/train-state-machine.ts:319`
- **Before**: `speedMultiplier: state.speedMultiplier * adjustment`
- **After**: `speedMultiplier: Math.max(0.5, Math.min(2.0, adjustment))`
- **Test**: Added bounds test, passes

---

## What Needs To Be Fixed

### Dual Update Conflict (NOT DONE)
- **File**: `src/components/map/hooks/useTrainMarkers.ts`
- **Lines**: 539-552
- **Action**: REMOVE entire block
- **Why**: State machine handles this via `API_UPDATE`

---

## Architecture

### Intended Flow
```
API Data → useTrainMarkers → dispatch API_UPDATE → State Machine → Animation Loop → Marker
```

### Actual Flow (Broken)
```
API Data → useTrainMarkers → dispatch API_UPDATE → State Machine
                          ↓
               ALSO directly updates filter.s, prevS, nextS  ← BUG
                          ↓
Animation Loop reads from state machine but bounds are wrong → ZIG-ZAG
```

---

## Key Thresholds

```typescript
const ARRIVING_DISTANCE = 200;       // meters - show "Arriving" within 200m
const STATION_SNAP_DISTANCE = 20;    // meters - SNAP to station within 20m
const DWELL_DURATION_DEFAULT = 2;    // seconds - dwell at station
const SYNC_SNAP_THRESHOLD = 0.3;     // 30% discrepancy → snap
const SYNC_ADJUST_THRESHOLD = 0.1;   // 10-30% → adjust speed
```

---

## Test Commands

```bash
# Run unit tests
npx vitest run src/lib/map/train-state-machine.test.ts

# Run integration tests
npx vitest run src/lib/map/real-data.test.ts

# Kill dev servers
taskkill //F //IM node.exe

# Start dev
npm run dev
```

---

## Session History

| Date | Action |
|------|--------|
| 2025-12-06 | Fixed undefined constants (STATION_THRESHOLD, ARRIVAL_THRESHOLD) |
| 2025-12-06 | Created real-data.test.ts with GTFS integration |
| 2025-12-06 | Completed initial code review |
| 2025-12-06 | Fixed speed multiplier compounding bug |
| 2025-12-06 | Completed integration review - found root cause |
| 2025-12-06 | ROOT CAUSE: Dual update conflict at useTrainMarkers.ts:539-552 |
