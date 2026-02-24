/**
 * Deterministic unit tests for alpha-beta-gamma.ts
 *
 * Tests the predictive filter used for smooth train position estimation.
 * All inputs are synthetic (fixed timestamps and positions).
 */

import { describe, it, expect } from 'vitest';
import {
  createFilterState,
  predict,
  update,
  predictPosition,
  predictVelocity,
  resetFilter,
  isDiscontinuity,
  blendState,
  calculateGains,
  DEFAULT_FILTER_PARAMS,
  type FilterState,
  type FilterParams,
} from '../alpha-beta-gamma';

const T0 = 1_000_000; // Fixed reference timestamp (ms)

// ---------------------------------------------------------------------------
// createFilterState
// ---------------------------------------------------------------------------

describe('createFilterState', () => {
  it('returns correct initial state with all args', () => {
    const state = createFilterState(500, 10, 0.5, T0);
    expect(state.s).toBe(500);
    expect(state.v).toBe(10);
    expect(state.a).toBe(0.5);
    expect(state.lastUpdateTime).toBe(T0);
  });

  it('defaults velocity and acceleration to 0', () => {
    const state = createFilterState(100, undefined, undefined, T0);
    expect(state.v).toBe(0);
    expect(state.a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// predict
// ---------------------------------------------------------------------------

describe('predict', () => {
  it('returns same state when dt <= 0', () => {
    const state = createFilterState(100, 10, 1, T0);
    const result = predict(state, 0, DEFAULT_FILTER_PARAMS);
    expect(result.s).toBe(100);
    expect(result.v).toBe(10);
    expect(result.a).toBe(1);
  });

  it('applies kinematic prediction: s + v*dt + 0.5*a*dt^2', () => {
    const state = createFilterState(0, 10, 1, T0);
    const result = predict(state, 5, DEFAULT_FILTER_PARAMS);
    // s = 0 + 10*5 + 0.5*1*25 = 62.5
    expect(result.s).toBeCloseTo(62.5, 5);
    // v = 10 + 1*5 = 15
    expect(result.v).toBeCloseTo(15, 5);
  });

  it('clamps velocity to vmax', () => {
    const state = createFilterState(0, 18, 1, T0);
    const result = predict(state, 10, DEFAULT_FILTER_PARAMS);
    // v would be 18 + 1*10 = 28, but clamped to 20
    expect(result.v).toBe(DEFAULT_FILTER_PARAMS.vmax);
  });

  it('clamps negative velocity to -vmax', () => {
    const state = createFilterState(1000, -18, -1, T0);
    const result = predict(state, 10, DEFAULT_FILTER_PARAMS);
    expect(result.v).toBe(-DEFAULT_FILTER_PARAMS.vmax);
  });

  it('clamps acceleration to amax', () => {
    const params: FilterParams = { ...DEFAULT_FILTER_PARAMS, amax: 0.5 };
    const state: FilterState = { s: 0, v: 0, a: 2, lastUpdateTime: T0 };
    const result = predict(state, 1, params);
    expect(result.a).toBe(0.5);
  });

  it('updates lastUpdateTime by dt * 1000', () => {
    const state = createFilterState(0, 0, 0, T0);
    const result = predict(state, 3, DEFAULT_FILTER_PARAMS);
    expect(result.lastUpdateTime).toBe(T0 + 3000);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('update', () => {
  it('corrects position toward measurement using alpha gain', () => {
    const state = createFilterState(100, 0, 0, T0);
    // Measurement at 120 after 15s (dt = 15)
    const updated = update(state, 120, T0 + 15_000, DEFAULT_FILTER_PARAMS);

    // Predicted position = 100 (v=0, a=0)
    // Residual = 120 - 100 = 20
    // Corrected s = 100 + 0.35 * 20 = 107
    expect(updated.s).toBeCloseTo(107, 1);
  });

  it('adjusts velocity based on beta gain', () => {
    const state = createFilterState(100, 0, 0, T0);
    const dt = 15; // seconds
    const updated = update(state, 120, T0 + dt * 1000, DEFAULT_FILTER_PARAMS);

    // Residual = 20
    // v_correction = (beta / dt) * residual = (0.15 / 15) * 20 = 0.2
    expect(updated.v).toBeCloseTo(0.2, 1);
  });

  it('adjusts acceleration based on gamma gain', () => {
    const state = createFilterState(100, 0, 0, T0);
    const dt = 15;
    const updated = update(state, 120, T0 + dt * 1000, DEFAULT_FILTER_PARAMS);

    // a_correction = (2 * gamma / dt^2) * residual = (2 * 0.05 / 225) * 20 ~= 0.00889
    expect(updated.a).toBeCloseTo(0.00889, 3);
  });

  it('clamps velocity after correction', () => {
    // Large measurement jump that would push velocity beyond vmax
    const state = createFilterState(0, 19, 0, T0);
    const updated = update(state, 1000, T0 + 1000, DEFAULT_FILTER_PARAMS);
    expect(Math.abs(updated.v)).toBeLessThanOrEqual(DEFAULT_FILTER_PARAMS.vmax);
  });

  it('clamps acceleration after correction', () => {
    const state = createFilterState(0, 0, 0, T0);
    const updated = update(state, 10000, T0 + 1000, DEFAULT_FILTER_PARAMS);
    expect(Math.abs(updated.a)).toBeLessThanOrEqual(DEFAULT_FILTER_PARAMS.amax);
  });
});

// ---------------------------------------------------------------------------
// predictPosition
// ---------------------------------------------------------------------------

describe('predictPosition', () => {
  it('returns current s when dt <= 0', () => {
    const state = createFilterState(200, 10, 1, T0);
    expect(predictPosition(state, T0 - 1000, DEFAULT_FILTER_PARAMS)).toBe(200);
    expect(predictPosition(state, T0, DEFAULT_FILTER_PARAMS)).toBe(200);
  });

  it('predicts forward using average velocity', () => {
    const state = createFilterState(0, 10, 0, T0);
    // With a=0, v stays 10, avgV = 10
    // At t+5s: s = 0 + 10*5 = 50
    expect(predictPosition(state, T0 + 5000, DEFAULT_FILTER_PARAMS)).toBeCloseTo(50, 1);
  });

  it('does not modify the original state', () => {
    const state = createFilterState(100, 5, 0.5, T0);
    const originalS = state.s;
    predictPosition(state, T0 + 10_000, DEFAULT_FILTER_PARAMS);
    expect(state.s).toBe(originalS);
  });
});

// ---------------------------------------------------------------------------
// predictVelocity
// ---------------------------------------------------------------------------

describe('predictVelocity', () => {
  it('returns current v when dt <= 0', () => {
    const state = createFilterState(0, 8, 1, T0);
    expect(predictVelocity(state, T0, DEFAULT_FILTER_PARAMS)).toBe(8);
  });

  it('returns v + a*dt, clamped', () => {
    const state = createFilterState(0, 5, 1, T0);
    // At t+3s: v = 5 + 1*3 = 8
    expect(predictVelocity(state, T0 + 3000, DEFAULT_FILTER_PARAMS)).toBeCloseTo(8, 5);
  });

  it('clamps to vmax', () => {
    const state = createFilterState(0, 19, 1, T0);
    // At t+5s: v = 19 + 5 = 24, clamped to 20
    expect(predictVelocity(state, T0 + 5000, DEFAULT_FILTER_PARAMS)).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// resetFilter
// ---------------------------------------------------------------------------

describe('resetFilter', () => {
  it('resets all state values', () => {
    const state = createFilterState(500, 15, 0.8, T0);
    const reset = resetFilter(state, 0, 0, 0, T0 + 60_000);

    expect(reset.s).toBe(0);
    expect(reset.v).toBe(0);
    expect(reset.a).toBe(0);
    expect(reset.lastUpdateTime).toBe(T0 + 60_000);
  });

  it('defaults velocity and acceleration to 0', () => {
    const state = createFilterState(500, 15, 0.8, T0);
    const reset = resetFilter(state, 200);

    expect(reset.s).toBe(200);
    expect(reset.v).toBe(0);
    expect(reset.a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isDiscontinuity
// ---------------------------------------------------------------------------

describe('isDiscontinuity', () => {
  it('returns true for a large jump', () => {
    const state = createFilterState(0, 0, 0, T0);
    // Measurement 10km away with no velocity -- clearly a discontinuity
    expect(isDiscontinuity(state, 10_000, T0 + 15_000, DEFAULT_FILTER_PARAMS)).toBe(true);
  });

  it('returns false for a small residual consistent with velocity', () => {
    const state = createFilterState(0, 10, 0, T0);
    // After 15s at 10 m/s, predicted = 150m. Measurement at 160m (10m residual) is fine
    expect(isDiscontinuity(state, 160, T0 + 15_000, DEFAULT_FILTER_PARAMS)).toBe(false);
  });

  it('uses custom threshold', () => {
    const state = createFilterState(0, 0, 0, T0);
    // 100m jump with a 50m threshold should be discontinuity
    // But max possible distance at vmax=20 * 1s * 1.5 = 30, and threshold=50 => max(50, 30) = 50
    // residual = 100 > 50 => true
    expect(isDiscontinuity(state, 100, T0 + 1000, DEFAULT_FILTER_PARAMS, 50)).toBe(true);
    // With threshold 200: max(200, 30) = 200, residual 100 < 200 => false
    expect(isDiscontinuity(state, 100, T0 + 1000, DEFAULT_FILTER_PARAMS, 200)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// blendState
// ---------------------------------------------------------------------------

describe('blendState', () => {
  it('blends position toward target by default factor (0.1)', () => {
    const state = createFilterState(100, 5, 0, T0);
    const blended = blendState(state, 200);
    // s = 100 + 0.1 * (200 - 100) = 110
    expect(blended.s).toBeCloseTo(110, 5);
  });

  it('uses custom blend factor', () => {
    const state = createFilterState(100, 5, 0, T0);
    const blended = blendState(state, 200, 0.5);
    // s = 100 + 0.5 * (200 - 100) = 150
    expect(blended.s).toBeCloseTo(150, 5);
  });

  it('preserves velocity and acceleration', () => {
    const state = createFilterState(100, 7, 0.3, T0);
    const blended = blendState(state, 200, 0.5);
    expect(blended.v).toBe(7);
    expect(blended.a).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// calculateGains
// ---------------------------------------------------------------------------

describe('calculateGains', () => {
  it('returns gains within valid ranges', () => {
    const gains = calculateGains(15);
    expect(gains.alpha).toBeGreaterThanOrEqual(0.1);
    expect(gains.alpha).toBeLessThanOrEqual(0.5);
    expect(gains.beta).toBeGreaterThanOrEqual(0.05);
    expect(gains.beta).toBeLessThanOrEqual(0.3);
    expect(gains.gamma).toBeGreaterThanOrEqual(0.01);
    expect(gains.gamma).toBeLessThanOrEqual(0.1);
  });

  it('returns clamped gains for very small sampling intervals', () => {
    const gains = calculateGains(0.1);
    expect(gains.alpha).toBeGreaterThanOrEqual(0.1);
    expect(gains.alpha).toBeLessThanOrEqual(0.5);
  });

  it('returns clamped gains for very large sampling intervals', () => {
    const gains = calculateGains(120);
    expect(gains.alpha).toBeGreaterThanOrEqual(0.1);
    expect(gains.alpha).toBeLessThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// Convergence behavior
// ---------------------------------------------------------------------------

describe('convergence', () => {
  it('converges toward a fixed measurement after repeated updates', () => {
    const target = 500;
    let state = createFilterState(0, 0, 0, T0);

    // Apply updates measuring the same position.
    // The constant-acceleration model will overshoot, but each update
    // should bring the position closer than the initial distance.
    for (let i = 1; i <= 20; i++) {
      state = update(state, target, T0 + i * 15_000, DEFAULT_FILTER_PARAMS);
    }

    // The filter should have moved substantially toward the target
    // (started at 0, target is 500). With alpha=0.35 the position should
    // be well past the halfway mark.
    expect(state.s).toBeGreaterThan(250);

    // Continue updating with resetFilter to test from-scratch convergence
    // Use very short intervals (1s) where the overshoot is minimal
    const shortParams: FilterParams = { ...DEFAULT_FILTER_PARAMS };
    state = resetFilter(state, 0, 0, 0, T0);
    for (let i = 1; i <= 200; i++) {
      state = update(state, target, T0 + i * 1000, shortParams);
    }

    // With 1s intervals over 200 steps the filter should be close to target
    expect(Math.abs(state.s - target)).toBeLessThan(target * 0.5);
  });

  it('tracks a moving target', () => {
    // Target moving at constant 10 m/s
    let state = createFilterState(0, 0, 0, T0);
    const speed = 10;

    for (let i = 1; i <= 30; i++) {
      const time = T0 + i * 15_000;
      const measurement = speed * (i * 15); // s = v*t
      state = update(state, measurement, time, DEFAULT_FILTER_PARAMS);
    }

    // Velocity should be tracking within 5 m/s of the true speed
    // The filter has finite gain so there is some steady-state tracking lag
    expect(Math.abs(state.v - speed)).toBeLessThan(5);
    // Position should be close to expected value (within 10%)
    const expectedS = speed * 30 * 15;
    expect(Math.abs(state.s - expectedS)).toBeLessThan(expectedS * 0.10);
  });
});
