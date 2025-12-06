# Handoff Notes - Train Animation Fix

**Last Updated**: 2025-12-06T14:30:00Z
**Status**: CODE REVIEW COMPLETE - 4 CRITICAL BUGS FOUND

## What Was Being Worked On

Fixing train animation so trains reach stations. Code exists but is broken due to multiple bugs.

## CRITICAL BUGS FOUND

### BUG 1: speedMultiplier Wrong
- Location: `useTrainMarkers.ts:273-274`
- Uses `getRouteSpeedMultiplier(alerts, routeId)` - WRONG
- Should use: `scheduledDuration / apiDuration`

### BUG 2: State Machine Hardcoded 90s
- Location: `train-state-machine.ts:96-97`
- `scheduledDuration: 90` never updated from GTFS matrix
- Fix: Pass duration to createTrainAnimationState()

### BUG 3: Duplicate State Not Synced
- TrainMotionState has: scheduledDuration, speedMultiplier, segmentStartTime
- TrainAnimationState has: same fields
- Updates don't sync between them!
- Fix: Use ONLY state machine, remove duplicates

### BUG 4: Wrong Thresholds
- ARRIVAL_THRESHOLD = 0.95 (should be 0.8)
- STATION_THRESHOLD = 0.99 (should be 1.0)

## PLAN FILE

**Location**: `C:\Users\User\.claude\plans\nested-plotting-aho.md`

Contains full fix plan with code examples.

## Files to Create (Copy-Paste Ready)

### 1. `src/lib/map/route-durations.ts`

```typescript
/**
 * Route Duration Matrix
 * Pre-computes travel time between consecutive stops from GTFS stop_times.txt
 */

// routeId → fromStopId → toStopId → durationSeconds
export type RouteDurationMatrix = Map<string, Map<string, Map<string, number>>>;

let matrixCache: RouteDurationMatrix | null = null;
let matrixPromise: Promise<RouteDurationMatrix> | null = null;

/**
 * Parse time string "HH:MM:SS" to seconds from midnight
 */
function parseTimeToSeconds(timeStr: string): number {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Build the route duration matrix from GTFS data
 */
export async function buildRouteDurationMatrix(): Promise<RouteDurationMatrix> {
  if (matrixCache) return matrixCache;
  if (matrixPromise) return matrixPromise;

  matrixPromise = (async () => {
    // Fetch both files
    const [tripsRes, stopTimesRes] = await Promise.all([
      fetch('/data/trips.txt'),
      fetch('/data/stop_times.txt')
    ]);

    const tripsText = await tripsRes.text();
    const stopTimesText = await stopTimesRes.text();

    // Parse trips.txt → Map<tripId, routeId>
    const tripToRoute = new Map<string, string>();
    const tripLines = tripsText.split('\n').slice(1); // Skip header
    for (const line of tripLines) {
      if (!line.trim()) continue;
      const [routeId, , tripId] = line.split(',');
      if (routeId && tripId) {
        tripToRoute.set(tripId.trim(), routeId.trim());
      }
    }

    // Parse stop_times.txt and group by trip
    // trip_id, stop_id, arrival_time, departure_time, stop_sequence
    const tripStops = new Map<string, Array<{ stopId: string; arrivalSec: number; seq: number }>>();
    const stopTimesLines = stopTimesText.split('\n').slice(1);
    for (const line of stopTimesLines) {
      if (!line.trim()) continue;
      const parts = line.split(',');
      const tripId = parts[0]?.trim();
      const stopId = parts[1]?.trim();
      const arrivalTime = parts[2]?.trim();
      const seq = parseInt(parts[4]?.trim() || '0', 10);

      if (!tripId || !stopId || !arrivalTime) continue;

      const arrivalSec = parseTimeToSeconds(arrivalTime);
      if (!tripStops.has(tripId)) {
        tripStops.set(tripId, []);
      }
      tripStops.get(tripId)!.push({ stopId, arrivalSec, seq });
    }

    // Build matrix: for each trip, calculate duration between consecutive stops
    // Then aggregate by route (average)
    const routeDurations: Map<string, Map<string, Map<string, number[]>>> = new Map();

    for (const [tripId, stops] of tripStops) {
      const routeId = tripToRoute.get(tripId);
      if (!routeId) continue;

      // Sort by sequence
      stops.sort((a, b) => a.seq - b.seq);

      // Calculate durations between consecutive stops
      for (let i = 0; i < stops.length - 1; i++) {
        const from = stops[i];
        const to = stops[i + 1];
        const duration = to.arrivalSec - from.arrivalSec;

        // Handle overnight trips (arrival < departure)
        const adjustedDuration = duration < 0 ? duration + 86400 : duration;

        if (!routeDurations.has(routeId)) {
          routeDurations.set(routeId, new Map());
        }
        const fromMap = routeDurations.get(routeId)!;
        if (!fromMap.has(from.stopId)) {
          fromMap.set(from.stopId, new Map());
        }
        const toMap = fromMap.get(from.stopId)!;
        if (!toMap.has(to.stopId)) {
          toMap.set(to.stopId, []);
        }
        toMap.get(to.stopId)!.push(adjustedDuration);
      }
    }

    // Average the durations
    const matrix: RouteDurationMatrix = new Map();
    for (const [routeId, fromMap] of routeDurations) {
      matrix.set(routeId, new Map());
      const routeMatrix = matrix.get(routeId)!;
      for (const [fromStop, toMap] of fromMap) {
        routeMatrix.set(fromStop, new Map());
        const fromMatrix = routeMatrix.get(fromStop)!;
        for (const [toStop, durations] of toMap) {
          const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
          fromMatrix.set(toStop, Math.round(avg));
        }
      }
    }

    matrixCache = matrix;
    console.log(`[route-durations] Built matrix for ${matrix.size} routes`);
    return matrix;
  })();

  return matrixPromise;
}

/**
 * Get duration between two stops for a route
 * Returns seconds, or undefined if not found
 */
export function getSegmentDuration(
  matrix: RouteDurationMatrix,
  routeId: string,
  fromStopId: string,
  toStopId: string
): number | undefined {
  // Try exact match
  const duration = matrix.get(routeId)?.get(fromStopId)?.get(toStopId);
  if (duration !== undefined) return duration;

  // Try without direction suffix (N/S)
  const fromBase = fromStopId.replace(/[NS]$/, '');
  const toBase = toStopId.replace(/[NS]$/, '');

  // Try all combinations
  for (const from of [fromStopId, fromBase + 'N', fromBase + 'S', fromBase]) {
    for (const to of [toStopId, toBase + 'N', toBase + 'S', toBase]) {
      const d = matrix.get(routeId)?.get(from)?.get(to);
      if (d !== undefined) return d;
    }
  }

  return undefined;
}
```

### 2. `src/lib/map/alert-speed.ts`

```typescript
/**
 * Alert-based speed modulation
 * Adjusts animation speed based on active service alerts
 */

import type { ServiceAlert } from '@/types/mta';

/**
 * Get speed multiplier for a route based on active alerts
 * Returns 0.5-1.0 (lower = slower animation for delays)
 */
export function getRouteSpeedMultiplier(
  alerts: ServiceAlert[],
  routeId: string
): number {
  const routeAlerts = alerts.filter(a =>
    a.affectedRoutes.some(r => r.toUpperCase() === routeId.toUpperCase())
  );

  if (routeAlerts.length === 0) return 1.0;

  // Find most severe alert
  for (const alert of routeAlerts) {
    const type = alert.alertType.toLowerCase();
    if (type.includes('suspension') || type.includes('cancel')) {
      return 0.5; // Major slowdown
    }
  }

  for (const alert of routeAlerts) {
    const type = alert.alertType.toLowerCase();
    if (type.includes('delay')) {
      return 0.8; // Moderate slowdown
    }
  }

  for (const alert of routeAlerts) {
    const type = alert.alertType.toLowerCase();
    if (type.includes('service change') || type.includes('detour')) {
      return 0.9; // Minor slowdown
    }
  }

  return 1.0; // Normal speed
}
```

## Animation Logic Change

**In `useMapAnimation.ts`, replace the animation loop with:**

```typescript
// Get scheduled duration from matrix
const scheduledDuration = getSegmentDuration(
  durationMatrix,
  state.routeId,
  state.prevStopId,
  state.nextStopId
) || 90; // Default 90 seconds

// Get speed multiplier from alerts
const speedMultiplier = getRouteSpeedMultiplier(alerts, state.routeId);

// Adjusted duration (slower if delays)
const adjustedDuration = scheduledDuration / speedMultiplier;

// Calculate progress based on when train entered segment
const elapsed = (nowMs - state.segmentStartTime) / 1000;
const progress = Math.min(1.0, elapsed / adjustedDuration);

// Direct lerp - NO smooth factor
const targetS = state.prevS + (state.nextS - state.prevS) * progress;

// CRITICAL: SNAP to station when arrived
if (progress >= 1.0) {
  state.filter.s = state.nextS;  // Exact station position!
} else {
  state.filter.s = targetS;
}

// Convert to lat/lon
const [lat, lon] = arclengthToLatLon(state.filter.s, state.track);
state.marker.setLngLat([lon, lat]);
```

## Commands to Run

```bash
cd C:/Users/User/Documents/RND/_dev_/TS/traintracker
npm run dev
# Open http://localhost:3000/map
```

## Key Changes from Previous Approach

| Before | After |
|--------|-------|
| Smooth factor 0.1 (never reaches target) | Direct lerp (reaches target) |
| API timing (stale) | Pre-computed from stop_times.txt |
| No snap at arrival | SNAP when progress >= 1.0 |
| No delay handling | Alert-based speed modulation |

## Why Previous Approach Failed

```typescript
// BROKEN - asymptotic decay:
state.filter.s = state.filter.s + 0.1 * (targetS - state.filter.s);
// After 100 frames: 0.9^100 = 0.000027 of distance remaining
// NEVER reaches exactly 0!

// FIXED - direct assignment with snap:
if (progress >= 1.0) {
  state.filter.s = state.nextS; // EXACTLY at station
} else {
  state.filter.s = targetS; // Direct lerp, no smoothing
}
```
