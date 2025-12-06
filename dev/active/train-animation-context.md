# Train Animation System - Implementation Context

**Last Updated**: 2025-12-06T13:15:00Z
**Status**: IN PROGRESS - NEW APPROACH (Schedule-Based + Alert Modulation)

## Problem Statement

Trains never actually reach station positions - they teleport before/after but never intersect the station point. This has been a multi-week issue.

## Root Cause Analysis (Final)

The previous approaches failed because:

### Issue 1: Asymptotic Smooth Factor
```typescript
state.filter.s = state.filter.s + 0.1 * (targetS - state.filter.s);
```
With smoothFactor=0.1, each frame reduces distance by 10% - exponential decay that **never reaches zero**. After 100 frames, still 0.00003% away.

### Issue 2: API Timing Unreliable
- `prevTimeMs`/`nextTimeMs` from API can be stale (5-10s latency)
- Timing doesn't account for delays or service changes
- Creates mismatch between animation and actual train position

### Issue 3: No Station Snap
- Code never explicitly snaps train to station when `progress >= 1.0`
- Train hovers near station but never exactly at it

## NEW SOLUTION: Schedule-Based Animation + Alert Modulation

**Plan Location**: `C:\Users\User\.claude\plans\bubbly-skipping-glade.md`

### Core Insight (User's Idea)
Instead of relying on API timing, use:
1. **Pre-computed duration matrix** from `stop_times.txt` - known travel time between consecutive stops
2. **Fixed animation with speed modulation** - animate at baseline speed, adjust based on alerts
3. **Hybrid sync** - small speed adjustments for minor discrepancies, snap for large ones

### Data Flow
```
STATIC (load once):
  stop_times.txt + trips.txt → Route Duration Matrix
  Map<routeId, Map<fromStopId, Map<toStopId, durationSeconds>>>

DYNAMIC (live):
  /api/v1/trains → current segment (prevStopId, nextStopId)
  /api/v1/alerts → delay/suspension info per route

ANIMATION:
  1. duration = matrix[routeId][prevStop][nextStop]
  2. speedMult = getRouteSpeedMultiplier(alerts, routeId) // 0.5-1.0
  3. adjustedDuration = duration / speedMult
  4. progress = elapsed / adjustedDuration
  5. if (progress >= 1.0) SNAP to station else lerp
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/map/route-durations.ts` | Build duration matrix from GTFS stop_times.txt |
| `src/lib/map/alert-speed.ts` | Calculate speed multiplier from alerts |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/map/hooks/useMapAnimation.ts` | Duration-based animation, SNAP at arrival |
| `src/components/map/hooks/useTrainMarkers.ts` | Track `segmentStartTime`, pass alerts |
| `src/components/map/SubwayMap.tsx` | Load duration matrix once, pass alerts to hooks |

## Key Decisions This Session

1. **By Route Keying**: Duration matrix keyed by route (not trip) - simpler, one value per stop pair
2. **Hybrid Sync**: Small speed adjustments for minor API discrepancies, snap for large ones
3. **Alert Speed Multipliers**:
   - `Suspension`: 0.5x speed
   - `Delays`: 0.8x speed
   - `Service Change`: 0.9x speed
   - Normal: 1.0x speed

## Existing Infrastructure (Reusable)

- `src/lib/mta/load-stop-times.ts` - Already parses stop_times.txt and trips.txt
- `src/lib/mta/schedule-lookup.ts` - Has delay calculation logic
- `src/lib/mta/fetch-alerts.ts` - Already has `filterAlertsByRoutes()` function
- `src/lib/map/track-index.ts` - Maps stops to arclengths
- `src/lib/map/arclength.ts` - Converts arclength to lat/lon

## Test Commands

```bash
cd C:/Users/User/Documents/RND/_dev_/TS/traintracker
npm run dev
# Open http://localhost:3000/map
# Watch trains - should now reach exact station positions
```

## Current Implementation Status

### COMPLETED:
1. ✅ Created `src/lib/map/route-durations.ts` - builds duration matrix from GTFS
2. ✅ Created `src/lib/map/alert-speed.ts` - speed multiplier from alerts
3. ✅ Modified `src/components/map/hooks/useMapAnimation.ts` - duration-based animation with SNAP
4. ✅ Modified `src/components/map/hooks/useTrainMarkers.ts` - segment timing + hybrid sync
5. ✅ Modified `src/components/map/SubwayMap.tsx` - loads matrix, passes alerts
6. ✅ Build passes with no TypeScript errors

### Key Code Changes:
- Animation uses `scheduledDuration` from matrix (seconds between stops)
- Speed multiplied by alerts: 0.5x (suspension), 0.8x (delays), 0.9x (service change)
- Progress calculated as `elapsed / adjustedDuration`
- When `progress >= 1.0`, SNAPS to exact station position (no asymptotic decay)
- Hybrid sync on API updates: >30% discrepancy snaps, <10% ignores
