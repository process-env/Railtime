# Train Animation Fix - Session Context

**Last Updated: 2025-12-06**

## Problem Statement

Train animations "zig-zag" and never properly reach stations. ETA display shows static "1 min".

## Root Cause Found

**Speed multiplier compounding bug** in `train-state-machine.ts:315`:
```typescript
// BUG: This MULTIPLIES, causing exponential drift
speedMultiplier: state.speedMultiplier * adjustment
```

After multiple API updates, speed can become 2x, 4x, 8x... causing erratic motion.

## Work Completed This Session

### 1. Fixed Undefined Constants ✅
The state machine referenced `STATION_THRESHOLD` and `ARRIVAL_THRESHOLD` which didn't exist.

**Fixed by:** Using distance-based detection instead:
```typescript
const distanceToStation = Math.abs(nextS - currentS);
const phase = distanceToStation <= STATION_SNAP_DISTANCE ? 'BOARDING' :
              distanceToStation <= ARRIVING_DISTANCE ? 'ARRIVING' : 'APPROACHING';
```

### 2. Created Real Data Test ✅
File: `src/lib/map/real-data.test.ts`

Tests the state machine with ACTUAL GTFS data from:
- `public/data/stops.txt` (real MTA stops)
- `public/map/nyc-subway-lines.geojson` (real track geometry)

Run with: `npx vitest run src/lib/map/real-data.test.ts`

### 3. Completed Full Code Review ✅
Created review documentation in `dev/review/train-animation-state-machine/`:
- `train-animation-review.md` - Full findings
- `train-animation-context.md` - Architecture context
- `train-animation-tasks.md` - Prioritized task list

## Files Modified This Session

| File | Change |
|------|--------|
| `src/lib/map/train-state-machine.ts` | Fixed undefined constants, using distance-based phase detection |
| `src/lib/map/train-state-machine.test.ts` | Added CSV output tests with mock data |
| `src/lib/map/real-data.test.ts` | **NEW** - Tests with real GTFS data |

## Key Technical Details

### State Machine Phases
```
APPROACHING ──(200m)──→ ARRIVING ──(20m snap)──→ BOARDING
```

### Thresholds (in meters)
- `ARRIVING_DISTANCE = 200` - Show "Arriving" status
- `STATION_SNAP_DISTANCE = 20` - Snap train to exact station position
- `DWELL_DURATION_DEFAULT = 2` - Seconds at station

### Data Flow
```
API (lat/lon) → useTrainMarkers (arclength lookup) → State Machine → Animation Loop → Marker
```

## Critical Bug NOT YET FIXED

**Speed multiplier compounding** at `train-state-machine.ts:315-322`:
```typescript
// Current (BUGGY):
return {
  ...state,
  speedMultiplier: state.speedMultiplier * adjustment, // COMPOUNDS!
};

// Should be:
return {
  ...state,
  speedMultiplier: Math.max(0.5, Math.min(2.0, adjustment)), // BOUNDED
};
```

## Next Immediate Steps

1. **Fix speed multiplier bug** (Critical)
   - File: `src/lib/map/train-state-machine.ts:315-322`
   - Change multiplication to direct assignment with bounds

2. **Run real data test** to verify fix
   ```bash
   npx vitest run src/lib/map/real-data.test.ts
   ```

3. **Test in browser** - refresh app and watch train animations

## Commands to Run on Restart

```bash
# Navigate to project
cd /c/Users/User/Documents/RND/_dev_/TS/traintracker

# Run tests with real data
npx vitest run src/lib/map/real-data.test.ts

# Start dev server (if not running)
npm run dev
```

## Background Processes

Multiple dev servers are running (from previous sessions):
- Bash 47843e, 2c2859, 79a38a, 6d274c, d35de8

Consider killing them: `taskkill //F //IM node.exe`

## User Context

User is frustrated and tired. Has been debugging this issue for multiple sessions. Wants to see actual test output (CSV) to verify the fix works. Does not trust verbal confirmations - wants proof via running tests.

## Plan File Location

Plan was at: `C:\Users\User\.claude\plans\nested-plotting-aho.md`
Status: Partially complete (tests created, undefined constants fixed, speed bug identified but not fixed)
