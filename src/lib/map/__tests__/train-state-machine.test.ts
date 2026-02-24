/**
 * Deterministic unit tests for train-state-machine.ts
 *
 * Replaces the CSV-dump diagnostic tests with proper behavioral assertions.
 * Uses synthetic R train stop data with fixed timestamps.
 */

import { describe, it, expect } from 'vitest';
import {
  createTrainAnimationState,
  trainAnimationReducer,
  getCurrentArclength,
  isAtStation,
  isArriving,
  getPhaseLabel,
  type TrainAnimationState,
} from '../train-state-machine';

// ---------------------------------------------------------------------------
// Synthetic test data
// ---------------------------------------------------------------------------

const ROUTE_ID = 'R';
const T0 = 1_000_000; // Fixed start timestamp (ms)

// Synthetic R train stops at 800m intervals
const STOPS = [
  { id: 'R16', name: 'Forest Hills-71 Av', s: 0 },
  { id: 'R17', name: '67 Av', s: 800 },
  { id: 'R18', name: '63 Dr-Rego Park', s: 1600 },
  { id: 'R19', name: 'Woodhaven Blvd', s: 2400 },
];

const DURATION = 90; // seconds between stops

// ---------------------------------------------------------------------------
// createTrainAnimationState
// ---------------------------------------------------------------------------

describe('createTrainAnimationState', () => {
  it('sets currentS to prevS when progress is 0', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );
    expect(state.currentS).toBe(STOPS[0].s);
    expect(state.progress).toBe(0);
    expect(state.phase).toBe('APPROACHING');
  });

  it('sets currentS to nextS and phase to BOARDING when progress is 1.0', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 1.0, DURATION, 1.0
    );
    expect(state.currentS).toBe(STOPS[1].s);
    expect(state.phase).toBe('BOARDING');
    expect(state.dwellStartTime).toBe(T0);
  });

  it('sets phase to ARRIVING when within 200m of station', () => {
    // 800m segment, progress 0.75 => 200m remaining
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.75, DURATION, 1.0
    );
    expect(state.currentS).toBe(600);
    expect(state.phase).toBe('ARRIVING');
  });

  it('sets phase to APPROACHING when far from station', () => {
    // 800m segment, progress 0.5 => 400m remaining
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.5, DURATION, 1.0
    );
    expect(state.currentS).toBe(400);
    expect(state.phase).toBe('APPROACHING');
  });

  it('stores speedMultiplier correctly', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 0.75
    );
    expect(state.speedMultiplier).toBe(0.75);
  });

  it('stores scheduledDuration correctly', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, 120, 1.0
    );
    expect(state.scheduledDuration).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// TICK action
// ---------------------------------------------------------------------------

describe('trainAnimationReducer - TICK', () => {
  it('advances progress over time in APPROACHING phase', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // Tick after 45s (half the duration)
    const ticked = trainAnimationReducer(state, { type: 'TICK', nowMs: T0 + 45_000 });

    expect(ticked.progress).toBeCloseTo(0.5, 1);
    expect(ticked.currentS).toBeCloseTo(400, 0);
    expect(ticked.phase).toBe('APPROACHING');
  });

  it('interpolates currentS between prevS and nextS', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    const ticked = trainAnimationReducer(state, { type: 'TICK', nowMs: T0 + 22_500 });
    // 22.5s / 90s = 0.25 progress => 200m
    expect(ticked.currentS).toBeCloseTo(200, 0);
  });

  it('transitions to ARRIVING when within 200m of station', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // At progress 0.75: 600m traveled, 200m remaining
    const ticked = trainAnimationReducer(state, {
      type: 'TICK',
      nowMs: T0 + DURATION * 0.75 * 1000,
    });
    expect(ticked.phase).toBe('ARRIVING');
  });

  it('transitions to BOARDING when within 20m of station', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // At full duration: progress = 1.0 => 0m remaining
    const ticked = trainAnimationReducer(state, {
      type: 'TICK',
      nowMs: T0 + DURATION * 1000,
    });
    expect(ticked.phase).toBe('BOARDING');
    expect(ticked.currentS).toBe(STOPS[1].s);
    expect(ticked.dwellStartTime).toBe(T0 + DURATION * 1000);
  });

  it('stays BOARDING with no pending segment', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 1.0, DURATION, 1.0
    );

    const ticked = trainAnimationReducer(state, { type: 'TICK', nowMs: T0 + 10_000 });
    expect(ticked.phase).toBe('BOARDING');
    expect(ticked.currentS).toBe(STOPS[1].s);
    expect(ticked.progress).toBe(1.0);
  });

  it('transitions from BOARDING to APPROACHING when pending segment and dwell complete', () => {
    // Create state at station with pending segment
    let state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 1.0, DURATION, 1.0
    );

    // Add pending segment via API_UPDATE
    state = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: T0 + 1000,
      prevStopId: STOPS[1].id,
      nextStopId: STOPS[2].id,
      prevS: STOPS[1].s,
      nextS: STOPS[2].s,
      apiProgress: 0,
    });

    expect(state.pendingSegment).not.toBeNull();

    // Tick after dwell time (default 2s)
    const ticked = trainAnimationReducer(state, { type: 'TICK', nowMs: T0 + 5000 });
    expect(ticked.phase).toBe('APPROACHING');
    expect(ticked.prevStopId).toBe(STOPS[1].id);
    expect(ticked.nextStopId).toBe(STOPS[2].id);
    expect(ticked.currentS).toBe(STOPS[1].s);
    expect(ticked.progress).toBe(0);
    expect(ticked.pendingSegment).toBeNull();
  });

  it('clamps progress to [0, 1]', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // Tick way past duration -- should snap to BOARDING not overshoot
    const ticked = trainAnimationReducer(state, {
      type: 'TICK',
      nowMs: T0 + DURATION * 2 * 1000,
    });
    expect(ticked.progress).toBeLessThanOrEqual(1.0);
    expect(ticked.phase).toBe('BOARDING');
  });
});

// ---------------------------------------------------------------------------
// API_UPDATE action
// ---------------------------------------------------------------------------

describe('trainAnimationReducer - API_UPDATE', () => {
  it('immediately transitions to new segment when APPROACHING', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.5, DURATION, 1.0
    );

    const updated = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: T0 + 50_000,
      prevStopId: STOPS[1].id,
      nextStopId: STOPS[2].id,
      prevS: STOPS[1].s,
      nextS: STOPS[2].s,
      apiProgress: 0.1,
    });

    expect(updated.prevStopId).toBe(STOPS[1].id);
    expect(updated.nextStopId).toBe(STOPS[2].id);
    expect(updated.progress).toBe(0.1);
    expect(updated.pendingSegment).toBeNull();
  });

  it('caches segment as pending when BOARDING', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 1.0, DURATION, 1.0
    );

    const updated = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: T0 + 1000,
      prevStopId: STOPS[1].id,
      nextStopId: STOPS[2].id,
      prevS: STOPS[1].s,
      nextS: STOPS[2].s,
      apiProgress: 0,
    });

    expect(updated.phase).toBe('BOARDING');
    expect(updated.pendingSegment).not.toBeNull();
    expect(updated.pendingSegment!.nextStopId).toBe(STOPS[2].id);
    // Original segment unchanged
    expect(updated.prevStopId).toBe(STOPS[0].id);
    expect(updated.nextStopId).toBe(STOPS[1].id);
  });

  it('ignores small discrepancy (<10%) on same segment', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // After 45s: our progress = 0.5
    // API says 0.55 -- only 5% discrepancy
    const updated = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: T0 + 45_000,
      prevStopId: STOPS[0].id,
      nextStopId: STOPS[1].id,
      prevS: STOPS[0].s,
      nextS: STOPS[1].s,
      apiProgress: 0.55,
    });

    // speedMultiplier should remain 1.0 (no adjustment)
    expect(updated.speedMultiplier).toBe(1.0);
  });

  it('adjusts speed on moderate discrepancy (10-30%)', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // After 45s: our progress = 0.5
    // API says 0.7 -- 20% discrepancy (> 10%, < 30%)
    const updated = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: T0 + 45_000,
      prevStopId: STOPS[0].id,
      nextStopId: STOPS[1].id,
      prevS: STOPS[0].s,
      nextS: STOPS[1].s,
      apiProgress: 0.7,
    });

    // Should have adjusted speed (we're behind, so multiplier > 1)
    expect(updated.speedMultiplier).not.toBe(1.0);
    expect(updated.speedMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(updated.speedMultiplier).toBeLessThanOrEqual(2.0);
  });

  it('snaps to API position on large discrepancy (>30%)', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // After 45s: our progress = 0.5
    // API says 0.9 -- 40% discrepancy
    const updated = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: T0 + 45_000,
      prevStopId: STOPS[0].id,
      nextStopId: STOPS[1].id,
      prevS: STOPS[0].s,
      nextS: STOPS[1].s,
      apiProgress: 0.9,
    });

    // Should snap: progress set to 0.9
    expect(updated.progress).toBe(0.9);
    expect(updated.currentS).toBeCloseTo(STOPS[0].s + (STOPS[1].s - STOPS[0].s) * 0.9, 0);
  });

  it('keeps speedMultiplier bounded [0.5, 2.0] after 100 updates (regression)', () => {
    let state = createTrainAnimationState(
      'trip-speed', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.3, DURATION, 1.0
    );

    // Simulate 100 API updates with persistent 15% discrepancy
    for (let i = 0; i < 100; i++) {
      const apiProgress = Math.min(1, state.progress + 0.15);

      state = trainAnimationReducer(state, {
        type: 'API_UPDATE',
        nowMs: T0 + i * 15_000,
        prevStopId: STOPS[0].id,
        nextStopId: STOPS[1].id,
        prevS: STOPS[0].s,
        nextS: STOPS[1].s,
        apiProgress,
      });
    }

    expect(state.speedMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(state.speedMultiplier).toBeLessThanOrEqual(2.0);
  });
});

// ---------------------------------------------------------------------------
// SET_DURATION / SET_SPEED_MULTIPLIER / FORCE_SNAP
// ---------------------------------------------------------------------------

describe('trainAnimationReducer - other actions', () => {
  it('SET_DURATION updates scheduledDuration', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );
    const updated = trainAnimationReducer(state, { type: 'SET_DURATION', duration: 120 });
    expect(updated.scheduledDuration).toBe(120);
  });

  it('SET_SPEED_MULTIPLIER updates multiplier', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );
    const updated = trainAnimationReducer(state, { type: 'SET_SPEED_MULTIPLIER', multiplier: 0.75 });
    expect(updated.speedMultiplier).toBe(0.75);
  });

  it('FORCE_SNAP sets currentS and recalculates progress', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );
    const updated = trainAnimationReducer(state, { type: 'FORCE_SNAP', s: 400 });
    expect(updated.currentS).toBe(400);
    expect(updated.progress).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('helper functions', () => {
  it('getCurrentArclength returns currentS', () => {
    const state = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.5, DURATION, 1.0
    );
    expect(getCurrentArclength(state)).toBe(state.currentS);
  });

  it('isAtStation returns true only for BOARDING', () => {
    const boarding = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 1.0, DURATION, 1.0
    );
    const approaching = createTrainAnimationState(
      'trip-2', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.5, DURATION, 1.0
    );

    expect(isAtStation(boarding)).toBe(true);
    expect(isAtStation(approaching)).toBe(false);
  });

  it('isArriving returns true only for ARRIVING', () => {
    const arriving = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.75, DURATION, 1.0
    );
    const approaching = createTrainAnimationState(
      'trip-2', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.5, DURATION, 1.0
    );

    expect(isArriving(arriving)).toBe(true);
    expect(isArriving(approaching)).toBe(false);
  });

  it('getPhaseLabel returns correct strings', () => {
    const boarding = createTrainAnimationState(
      'trip-1', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 1.0, DURATION, 1.0
    );
    const arriving = createTrainAnimationState(
      'trip-2', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.75, DURATION, 1.0
    );
    const approaching = createTrainAnimationState(
      'trip-3', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0.0, DURATION, 1.0
    );

    expect(getPhaseLabel(boarding)).toBe('Boarding');
    expect(getPhaseLabel(arriving)).toBe('Arriving');
    expect(getPhaseLabel(approaching)).toBe('En Route');
  });
});

// ---------------------------------------------------------------------------
// Full journey integration test (replaces CSV-dump journey test)
// ---------------------------------------------------------------------------

describe('full journey through multiple segments', () => {
  it('traverses 3 segments with dwells and API updates', () => {
    let state = createTrainAnimationState(
      'journey', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      T0, 0, DURATION, 1.0
    );

    // --- Segment 0: STOPS[0] -> STOPS[1] ---
    // Run until boarding
    let now = T0 + DURATION * 1000;
    state = trainAnimationReducer(state, { type: 'TICK', nowMs: now });
    expect(state.phase).toBe('BOARDING');
    expect(state.currentS).toBe(STOPS[1].s);

    // Dwell for 3s then API update
    now += 3000;
    state = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: now,
      prevStopId: STOPS[1].id,
      nextStopId: STOPS[2].id,
      prevS: STOPS[1].s,
      nextS: STOPS[2].s,
      apiProgress: 0,
    });
    state = trainAnimationReducer(state, { type: 'TICK', nowMs: now });

    // --- Segment 1: STOPS[1] -> STOPS[2] ---
    expect(state.phase).toBe('APPROACHING');
    expect(state.prevStopId).toBe(STOPS[1].id);
    expect(state.nextStopId).toBe(STOPS[2].id);
    expect(state.currentS).toBe(STOPS[1].s);

    // Run to completion
    now += DURATION * 1000;
    state = trainAnimationReducer(state, { type: 'TICK', nowMs: now });
    expect(state.phase).toBe('BOARDING');
    expect(state.currentS).toBe(STOPS[2].s);

    // Dwell then next segment
    now += 3000;
    state = trainAnimationReducer(state, {
      type: 'API_UPDATE',
      nowMs: now,
      prevStopId: STOPS[2].id,
      nextStopId: STOPS[3].id,
      prevS: STOPS[2].s,
      nextS: STOPS[3].s,
      apiProgress: 0,
    });
    state = trainAnimationReducer(state, { type: 'TICK', nowMs: now });

    // --- Segment 2: STOPS[2] -> STOPS[3] ---
    expect(state.phase).toBe('APPROACHING');
    expect(state.nextStopId).toBe(STOPS[3].id);

    // Run to completion
    now += DURATION * 1000;
    state = trainAnimationReducer(state, { type: 'TICK', nowMs: now });
    expect(state.phase).toBe('BOARDING');
    expect(state.currentS).toBe(STOPS[3].s);
  });
});
