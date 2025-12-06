/**
 * Motion Planner - Build piecewise motion plans for train animation
 *
 * Creates smooth trajectories that:
 * - Decelerate approaching stations
 * - Dwell at stations
 * - Accelerate departing stations
 * - Cruise between stations
 *
 * Uses trapezoidal velocity profile with physical constraints.
 */

export interface MotionSegment {
  type: 'cruise' | 'accel' | 'decel' | 'dwell';
  startTime: number;      // ms timestamp
  endTime: number;        // ms timestamp
  startS: number;         // meters
  endS: number;           // meters
  v0: number;             // initial velocity (m/s)
  a: number;              // acceleration (m/s², 0 for cruise/dwell)
}

export interface StopInfo {
  stopId: string;
  arclength: number;      // meters
  dwellTime?: number;     // optional override (ms)
}

export interface MotionPlanParams {
  currentS: number;       // Current position (meters)
  targetS: number;        // Target from API (meters)
  currentV: number;       // Current velocity (m/s)
  crossedStops: StopInfo[]; // Stops between current and target
  startTime: number;      // When plan starts (ms timestamp)
  timeWindow: number;     // Time until next API update (ms)
  vmax: number;           // Max velocity (m/s)
  amax: number;           // Max acceleration (m/s²)
  defaultDwell: number;   // Default dwell at stops (ms)
}

export interface MotionPlan {
  segments: MotionSegment[];
  estimatedArrival: number; // ms timestamp when reaching targetS
}

// Motion constants
export const MOTION_PARAMS = {
  vmax: 20,              // m/s (~72 km/h) - subway typical max
  amax: 1.0,             // m/s² - comfortable acceleration
  defaultDwell: 20000,   // ms (20s typical stop)
  terminalDwell: 40000,  // ms (40s at terminals)
  minDwell: 5000,        // ms (minimum dwell if time constrained)
  stopProximity: 30,     // meters - distance to consider "at station"

  // α-β-γ filter gains for ~15s sampling
  alpha: 0.35,
  beta: 0.15,
  gamma: 0.05,
};

/**
 * Evaluate a motion plan at a given time
 * Returns the arclength (s) at that time
 */
export function evaluatePlan(plan: MotionPlan, time: number): number {
  const { segments } = plan;

  if (segments.length === 0) {
    return 0;
  }

  // Find active segment
  for (const seg of segments) {
    if (time >= seg.startTime && time <= seg.endTime) {
      return evaluateSegment(seg, time);
    }
  }

  // If past all segments, return final position
  const lastSeg = segments[segments.length - 1];
  if (time > lastSeg.endTime) {
    return lastSeg.endS;
  }

  // If before all segments, return start position
  return segments[0].startS;
}

/**
 * Evaluate position within a single segment
 */
function evaluateSegment(seg: MotionSegment, time: number): number {
  const dt = (time - seg.startTime) / 1000; // Convert to seconds

  switch (seg.type) {
    case 'dwell':
      return seg.startS;

    case 'cruise':
      return seg.startS + seg.v0 * dt;

    case 'accel':
    case 'decel':
      // s = s0 + v0*t + 0.5*a*t²
      return seg.startS + seg.v0 * dt + 0.5 * seg.a * dt * dt;

    default:
      return seg.startS;
  }
}

/**
 * Evaluate velocity within a motion plan at a given time
 */
export function evaluateVelocity(plan: MotionPlan, time: number): number {
  const { segments } = plan;

  if (segments.length === 0) return 0;

  // Find active segment
  for (const seg of segments) {
    if (time >= seg.startTime && time <= seg.endTime) {
      const dt = (time - seg.startTime) / 1000;

      switch (seg.type) {
        case 'dwell':
          return 0;
        case 'cruise':
          return seg.v0;
        case 'accel':
        case 'decel':
          return seg.v0 + seg.a * dt;
        default:
          return 0;
      }
    }
  }

  // If past all segments, velocity is 0
  const lastSeg = segments[segments.length - 1];
  if (time > lastSeg.endTime) return 0;

  return 0;
}

/**
 * Build a motion plan from current position to target
 *
 * Strategy:
 * 1. Calculate total distance and available time
 * 2. For each stop in path: add decel -> dwell -> accel segments
 * 3. Fill gaps with cruise segments
 * 4. If time insufficient, reduce dwell times proportionally
 */
export function buildMotionPlan(params: MotionPlanParams): MotionPlan {
  const {
    currentS,
    targetS,
    currentV,
    crossedStops,
    startTime,
    timeWindow,
    vmax,
    amax,
    defaultDwell
  } = params;

  const segments: MotionSegment[] = [];
  const direction = targetS >= currentS ? 1 : -1;
  const totalDistance = Math.abs(targetS - currentS);

  // If no distance to cover, just dwell
  if (totalDistance < 1) {
    return {
      segments: [{
        type: 'dwell',
        startTime,
        endTime: startTime + timeWindow,
        startS: currentS,
        endS: currentS,
        v0: 0,
        a: 0
      }],
      estimatedArrival: startTime
    };
  }

  // Sort stops by distance from current position
  const sortedStops = [...crossedStops].sort((a, b) => {
    const distA = Math.abs(a.arclength - currentS);
    const distB = Math.abs(b.arclength - currentS);
    return distA - distB;
  });

  // Calculate total dwell time needed
  const totalDwellTime = sortedStops.reduce((sum, stop) =>
    sum + (stop.dwellTime || defaultDwell), 0
  );

  // Calculate minimum travel time (at max velocity)
  const minTravelTime = (totalDistance / vmax) * 1000; // ms

  // Check if we have enough time
  const availableTime = timeWindow;
  const neededTime = minTravelTime + totalDwellTime;

  // Scale factor for dwell times if time constrained
  const dwellScale = neededTime > availableTime
    ? Math.max(0, (availableTime - minTravelTime) / totalDwellTime)
    : 1;

  // Build segments
  let time = startTime;
  let s = currentS;
  let v = Math.abs(currentV);

  // Process each stop
  for (const stop of sortedStops) {
    const stopS = stop.arclength;
    const distToStop = Math.abs(stopS - s);

    if (distToStop < MOTION_PARAMS.stopProximity) {
      // Already at stop, just dwell
      const dwell = (stop.dwellTime || defaultDwell) * dwellScale;
      if (dwell > 0) {
        segments.push({
          type: 'dwell',
          startTime: time,
          endTime: time + dwell,
          startS: s,
          endS: s,
          v0: 0,
          a: 0
        });
        time += dwell;
      }
      continue;
    }

    // Deceleration distance: v² = 2*a*d => d = v²/(2*a)
    const decelDist = (vmax * vmax) / (2 * amax);

    // Phase 1: Accelerate to cruise velocity (if not already at vmax)
    if (v < vmax && distToStop > decelDist) {
      const accelDist = Math.min(
        (vmax * vmax - v * v) / (2 * amax),
        (distToStop - decelDist) / 2
      );
      const vEnd = Math.sqrt(v * v + 2 * amax * accelDist);
      const accelTime = (vEnd - v) / amax * 1000;

      if (accelTime > 0 && accelDist > 0) {
        segments.push({
          type: 'accel',
          startTime: time,
          endTime: time + accelTime,
          startS: s,
          endS: s + direction * accelDist,
          v0: v * direction,
          a: amax * direction
        });
        time += accelTime;
        s += direction * accelDist;
        v = vEnd;
      }
    }

    // Phase 2: Cruise
    const remainingDist = Math.abs(stopS - s);
    const cruiseDist = Math.max(0, remainingDist - decelDist);

    if (cruiseDist > 0 && v > 0) {
      const cruiseTime = (cruiseDist / v) * 1000;
      segments.push({
        type: 'cruise',
        startTime: time,
        endTime: time + cruiseTime,
        startS: s,
        endS: s + direction * cruiseDist,
        v0: v * direction,
        a: 0
      });
      time += cruiseTime;
      s += direction * cruiseDist;
    }

    // Phase 3: Decelerate to stop
    const finalDecelDist = Math.abs(stopS - s);
    if (finalDecelDist > 0 && v > 0) {
      const decelTime = v / amax * 1000;
      segments.push({
        type: 'decel',
        startTime: time,
        endTime: time + decelTime,
        startS: s,
        endS: stopS,
        v0: v * direction,
        a: -amax * direction
      });
      time += decelTime;
      s = stopS;
      v = 0;
    }

    // Phase 4: Dwell at stop
    const dwell = (stop.dwellTime || defaultDwell) * dwellScale;
    if (dwell > MOTION_PARAMS.minDwell * 0.1) {
      segments.push({
        type: 'dwell',
        startTime: time,
        endTime: time + dwell,
        startS: s,
        endS: s,
        v0: 0,
        a: 0
      });
      time += dwell;
    }
  }

  // Final leg: reach target
  const finalDist = Math.abs(targetS - s);
  if (finalDist > 1) {
    // Accelerate
    const accelDist = Math.min(finalDist / 2, (vmax * vmax) / (2 * amax));
    const vPeak = Math.sqrt(2 * amax * accelDist);
    const accelTime = vPeak / amax * 1000;

    if (accelDist > 0) {
      segments.push({
        type: 'accel',
        startTime: time,
        endTime: time + accelTime,
        startS: s,
        endS: s + direction * accelDist,
        v0: 0,
        a: amax * direction
      });
      time += accelTime;
      s += direction * accelDist;
      v = vPeak;
    }

    // Cruise (if distance allows)
    const cruiseDist = finalDist - 2 * accelDist;
    if (cruiseDist > 0 && v > 0) {
      const cruiseTime = (cruiseDist / v) * 1000;
      segments.push({
        type: 'cruise',
        startTime: time,
        endTime: time + cruiseTime,
        startS: s,
        endS: s + direction * cruiseDist,
        v0: v * direction,
        a: 0
      });
      time += cruiseTime;
      s += direction * cruiseDist;
    }

    // Decelerate
    const decelDist = Math.abs(targetS - s);
    if (decelDist > 0 && v > 0) {
      const decelTime = v / amax * 1000;
      segments.push({
        type: 'decel',
        startTime: time,
        endTime: time + decelTime,
        startS: s,
        endS: targetS,
        v0: v * direction,
        a: -amax * direction
      });
      time += decelTime;
    }
  }

  // If no segments created, add a simple cruise
  if (segments.length === 0) {
    const cruiseTime = timeWindow;
    const avgV = totalDistance / (cruiseTime / 1000);
    segments.push({
      type: 'cruise',
      startTime,
      endTime: startTime + cruiseTime,
      startS: currentS,
      endS: targetS,
      v0: avgV * direction,
      a: 0
    });
    time = startTime + cruiseTime;
  }

  return {
    segments,
    estimatedArrival: time
  };
}

/**
 * Create a simple linear motion plan (fallback)
 */
export function buildSimplePlan(
  currentS: number,
  targetS: number,
  startTime: number,
  duration: number
): MotionPlan {
  const distance = targetS - currentS;
  const velocity = distance / (duration / 1000);

  return {
    segments: [{
      type: 'cruise',
      startTime,
      endTime: startTime + duration,
      startS: currentS,
      endS: targetS,
      v0: velocity,
      a: 0
    }],
    estimatedArrival: startTime + duration
  };
}
