/**
 * Deterministic unit tests for motion-planner.ts
 *
 * Tests the core motion planning API with synthetic data:
 * - evaluatePlan / evaluateVelocity (read a plan at a given time)
 * - buildMotionPlan (construct trapezoidal-profile plans)
 * - buildSimplePlan (linear fallback)
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePlan,
  evaluateVelocity,
  buildMotionPlan,
  buildSimplePlan,
  MOTION_PARAMS,
  type MotionPlan,
  type MotionSegment,
} from '../motion-planner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: build a single-segment plan */
function singleSegmentPlan(seg: MotionSegment): MotionPlan {
  return { segments: [seg], estimatedArrival: seg.endTime };
}

const T0 = 1_000_000; // Fixed start timestamp (ms)

// ---------------------------------------------------------------------------
// evaluatePlan
// ---------------------------------------------------------------------------

describe('evaluatePlan', () => {
  it('returns 0 for an empty plan', () => {
    expect(evaluatePlan({ segments: [], estimatedArrival: T0 }, T0)).toBe(0);
  });

  it('returns startS for a dwell segment', () => {
    const plan = singleSegmentPlan({
      type: 'dwell',
      startTime: T0,
      endTime: T0 + 5000,
      startS: 400,
      endS: 400,
      v0: 0,
      a: 0,
    });
    expect(evaluatePlan(plan, T0 + 2500)).toBe(400);
  });

  it('interpolates linearly for a cruise segment', () => {
    const plan = singleSegmentPlan({
      type: 'cruise',
      startTime: T0,
      endTime: T0 + 10_000,
      startS: 0,
      endS: 200,
      v0: 20, // 20 m/s => 200m in 10s
      a: 0,
    });
    // At 5s: s = 0 + 20*5 = 100
    expect(evaluatePlan(plan, T0 + 5000)).toBeCloseTo(100, 1);
  });

  it('follows kinematics for an accel segment', () => {
    // s = s0 + v0*t + 0.5*a*t^2
    const plan = singleSegmentPlan({
      type: 'accel',
      startTime: T0,
      endTime: T0 + 4000,
      startS: 0,
      endS: 8, // 0 + 0*4 + 0.5*1*16 = 8
      v0: 0,
      a: 1, // 1 m/s^2
    });
    // At t=2s: s = 0 + 0 + 0.5*1*4 = 2
    expect(evaluatePlan(plan, T0 + 2000)).toBeCloseTo(2, 1);
    // At t=4s: s = 0 + 0 + 0.5*1*16 = 8
    expect(evaluatePlan(plan, T0 + 4000)).toBeCloseTo(8, 1);
  });

  it('follows kinematics for a decel segment', () => {
    // Start at v0=10 m/s, decelerate at -2 m/s^2
    // At t=3s: s = 100 + 10*3 + 0.5*(-2)*9 = 100 + 30 - 9 = 121
    const plan = singleSegmentPlan({
      type: 'decel',
      startTime: T0,
      endTime: T0 + 5000,
      startS: 100,
      endS: 125, // 100 + 10*5 + 0.5*(-2)*25 = 125
      v0: 10,
      a: -2,
    });
    expect(evaluatePlan(plan, T0 + 3000)).toBeCloseTo(121, 1);
  });

  it('returns final position when past all segments', () => {
    const plan = singleSegmentPlan({
      type: 'cruise',
      startTime: T0,
      endTime: T0 + 5000,
      startS: 0,
      endS: 100,
      v0: 20,
      a: 0,
    });
    expect(evaluatePlan(plan, T0 + 99_000)).toBe(100);
  });

  it('returns start position when before all segments', () => {
    const plan = singleSegmentPlan({
      type: 'cruise',
      startTime: T0 + 5000,
      endTime: T0 + 10_000,
      startS: 50,
      endS: 150,
      v0: 20,
      a: 0,
    });
    expect(evaluatePlan(plan, T0)).toBe(50);
  });

  it('evaluates multi-segment plans correctly', () => {
    const plan: MotionPlan = {
      segments: [
        {
          type: 'accel',
          startTime: T0,
          endTime: T0 + 2000,
          startS: 0,
          endS: 2, // 0.5*1*4
          v0: 0,
          a: 1,
        },
        {
          type: 'cruise',
          startTime: T0 + 2000,
          endTime: T0 + 7000,
          startS: 2,
          endS: 12, // 2 + 2*5 = 12
          v0: 2,
          a: 0,
        },
      ],
      estimatedArrival: T0 + 7000,
    };
    // In accel segment at t=1s: 0.5*1*1 = 0.5
    expect(evaluatePlan(plan, T0 + 1000)).toBeCloseTo(0.5, 1);
    // In cruise segment at t=4s (2s into cruise): 2 + 2*2 = 6
    expect(evaluatePlan(plan, T0 + 4000)).toBeCloseTo(6, 1);
  });
});

// ---------------------------------------------------------------------------
// evaluateVelocity
// ---------------------------------------------------------------------------

describe('evaluateVelocity', () => {
  it('returns 0 for an empty plan', () => {
    expect(evaluateVelocity({ segments: [], estimatedArrival: T0 }, T0)).toBe(0);
  });

  it('returns 0 for a dwell segment', () => {
    const plan = singleSegmentPlan({
      type: 'dwell',
      startTime: T0,
      endTime: T0 + 5000,
      startS: 100,
      endS: 100,
      v0: 0,
      a: 0,
    });
    expect(evaluateVelocity(plan, T0 + 2000)).toBe(0);
  });

  it('returns v0 for a cruise segment', () => {
    const plan = singleSegmentPlan({
      type: 'cruise',
      startTime: T0,
      endTime: T0 + 5000,
      startS: 0,
      endS: 75,
      v0: 15,
      a: 0,
    });
    expect(evaluateVelocity(plan, T0 + 2500)).toBe(15);
  });

  it('returns v0 + a*t for accel segment', () => {
    const plan = singleSegmentPlan({
      type: 'accel',
      startTime: T0,
      endTime: T0 + 5000,
      startS: 0,
      endS: 25,
      v0: 0,
      a: 2,
    });
    // At t=3s: v = 0 + 2*3 = 6
    expect(evaluateVelocity(plan, T0 + 3000)).toBeCloseTo(6, 1);
  });

  it('returns 0 when past all segments', () => {
    const plan = singleSegmentPlan({
      type: 'cruise',
      startTime: T0,
      endTime: T0 + 1000,
      startS: 0,
      endS: 20,
      v0: 20,
      a: 0,
    });
    expect(evaluateVelocity(plan, T0 + 5000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildMotionPlan
// ---------------------------------------------------------------------------

describe('buildMotionPlan', () => {
  it('returns a dwell segment when distance is zero', () => {
    const plan = buildMotionPlan({
      currentS: 500,
      targetS: 500,
      currentV: 0,
      crossedStops: [],
      startTime: T0,
      timeWindow: 15_000,
      vmax: MOTION_PARAMS.vmax,
      amax: MOTION_PARAMS.amax,
      defaultDwell: MOTION_PARAMS.defaultDwell,
    });

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].type).toBe('dwell');
    expect(plan.segments[0].startS).toBe(500);
    expect(plan.segments[0].endS).toBe(500);
  });

  it('creates a motion plan for forward travel without intermediate stops', () => {
    const plan = buildMotionPlan({
      currentS: 0,
      targetS: 1000,
      currentV: 0,
      crossedStops: [],
      startTime: T0,
      timeWindow: 120_000,
      vmax: 20,
      amax: 1.0,
      defaultDwell: 20_000,
    });

    // Should have at least one segment
    expect(plan.segments.length).toBeGreaterThan(0);

    // First segment should start at currentS
    expect(plan.segments[0].startS).toBe(0);

    // Last segment should end near targetS
    const lastSeg = plan.segments[plan.segments.length - 1];
    expect(lastSeg.endS).toBeCloseTo(1000, 0);

    // Should contain accel and decel phases
    const types = plan.segments.map((s) => s.type);
    expect(types).toContain('accel');
  });

  it('handles reverse direction (targetS < currentS)', () => {
    const plan = buildMotionPlan({
      currentS: 1000,
      targetS: 0,
      currentV: 0,
      crossedStops: [],
      startTime: T0,
      timeWindow: 120_000,
      vmax: 20,
      amax: 1.0,
      defaultDwell: 20_000,
    });

    expect(plan.segments.length).toBeGreaterThan(0);
    const lastSeg = plan.segments[plan.segments.length - 1];
    expect(lastSeg.endS).toBeCloseTo(0, 0);
  });

  it('includes dwell segments for intermediate stops', () => {
    const plan = buildMotionPlan({
      currentS: 0,
      targetS: 2000,
      currentV: 0,
      crossedStops: [{ stopId: 'S1', arclength: 1000 }],
      startTime: T0,
      timeWindow: 120_000,
      vmax: 20,
      amax: 1.0,
      defaultDwell: 5000,
    });

    const dwellSegments = plan.segments.filter((s) => s.type === 'dwell');
    expect(dwellSegments.length).toBeGreaterThan(0);
  });

  it('evaluating a plan stays within bounds', () => {
    const plan = buildMotionPlan({
      currentS: 0,
      targetS: 500,
      currentV: 5,
      crossedStops: [],
      startTime: T0,
      timeWindow: 60_000,
      vmax: 20,
      amax: 1.0,
      defaultDwell: 20_000,
    });

    // Check position at various times stays within [0, 500]
    for (let t = 0; t <= 60_000; t += 1000) {
      const s = evaluatePlan(plan, T0 + t);
      expect(s).toBeGreaterThanOrEqual(-1); // small float tolerance
      expect(s).toBeLessThanOrEqual(501);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSimplePlan
// ---------------------------------------------------------------------------

describe('buildSimplePlan', () => {
  it('creates a single cruise segment', () => {
    const plan = buildSimplePlan(0, 300, T0, 15_000);

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].type).toBe('cruise');
    expect(plan.segments[0].startS).toBe(0);
    expect(plan.segments[0].endS).toBe(300);
    expect(plan.segments[0].v0).toBeCloseTo(20, 1); // 300m / 15s = 20 m/s
    expect(plan.estimatedArrival).toBe(T0 + 15_000);
  });

  it('handles reverse direction', () => {
    const plan = buildSimplePlan(500, 200, T0, 10_000);

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].v0).toBeLessThan(0); // negative velocity
    expect(plan.segments[0].startS).toBe(500);
    expect(plan.segments[0].endS).toBe(200);
  });

  it('evaluates to endpoints at start and end times', () => {
    const plan = buildSimplePlan(100, 400, T0, 20_000);

    expect(evaluatePlan(plan, T0)).toBeCloseTo(100, 1);
    expect(evaluatePlan(plan, T0 + 20_000)).toBeCloseTo(400, 1);
  });

  it('interpolates linearly at midpoint', () => {
    const plan = buildSimplePlan(0, 600, T0, 30_000);

    // At midpoint: 300m
    expect(evaluatePlan(plan, T0 + 15_000)).toBeCloseTo(300, 1);
  });
});
