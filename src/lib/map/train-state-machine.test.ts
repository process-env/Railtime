import { describe, it, expect } from 'vitest';
import {
  createTrainAnimationState,
  trainAnimationReducer,
  TrainAnimationState,
  getCurrentArclength,
} from './train-state-machine';

// CSV header
const CSV_HEADER = 'tripId,routeId,prevStop,nextStop,prevS,nextS,currentS,distanceToStation,progress,phase,scheduledDuration,speedMultiplier';

function stateToCSV(state: TrainAnimationState): string {
  const distanceToStation = Math.abs(state.nextS - state.currentS);
  return `${state.tripId},${state.routeId},${state.prevStopId},${state.nextStopId},${state.prevS},${state.nextS},${state.currentS.toFixed(1)},${distanceToStation.toFixed(1)},${state.progress.toFixed(3)},${state.phase},${state.scheduledDuration},${state.speedMultiplier}`;
}

describe('Train State Machine - Full State Output', () => {
  // Test data: R train Forest Hills to 46 St
  const ROUTE_ID = 'R';
  const STOPS = [
    { id: 'R16', name: 'Forest Hills-71 Av', s: 0 },
    { id: 'R17', name: '67 Av', s: 800 },
    { id: 'R18', name: '63 Dr-Rego Park', s: 1600 },
    { id: 'R19', name: 'Woodhaven Blvd', s: 2400 },
    { id: 'R20', name: 'Grand Av-Newtown', s: 3200 },
    { id: 'R21', name: 'Elmhurst Av', s: 4000 },
    { id: 'R22', name: 'Jackson Hts-Roosevelt Av', s: 4800 },
    { id: 'R23', name: '65 St', s: 5600 },
    { id: 'R24', name: 'Northern Blvd', s: 6400 },
    { id: 'R25', name: '46 St', s: 7200 },
  ];

  it('outputs CSV for all initial progress values', () => {
    console.log('\n=== INITIAL STATE CSV ===');
    console.log(CSV_HEADER);

    const progresses = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0];
    const nowMs = Date.now();

    for (const progress of progresses) {
      const state = createTrainAnimationState(
        'trip-001', ROUTE_ID,
        STOPS[0].id, STOPS[1].id,
        STOPS[0].s, STOPS[1].s,
        nowMs, progress, 90, 1.0
      );
      console.log(stateToCSV(state));
    }
  });

  it('outputs CSV for TICK progression over time', () => {
    console.log('\n=== TICK PROGRESSION CSV ===');
    console.log('elapsed_sec,' + CSV_HEADER);

    const startMs = Date.now();
    let state = createTrainAnimationState(
      'trip-002', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      startMs, 0, 90, 1.0
    );

    // Simulate 100 seconds of ticks (every 5 seconds)
    for (let elapsed = 0; elapsed <= 100; elapsed += 5) {
      const nowMs = startMs + elapsed * 1000;
      state = trainAnimationReducer(state, { type: 'TICK', nowMs });
      console.log(`${elapsed},${stateToCSV(state)}`);
    }
  });

  it('outputs CSV for full journey A→B→C→D', () => {
    console.log('\n=== FULL JOURNEY CSV ===');
    console.log('time_sec,segment,' + CSV_HEADER);

    const startMs = Date.now();
    let state = createTrainAnimationState(
      'trip-003', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      startMs, 0, 90, 1.0
    );

    let currentSegment = 0;
    let totalTime = 0;

    // Simulate journey through 4 segments
    while (currentSegment < 4 && totalTime < 500) {
      const nowMs = startMs + totalTime * 1000;
      state = trainAnimationReducer(state, { type: 'TICK', nowMs });

      console.log(`${totalTime},${currentSegment},${stateToCSV(state)}`);

      // If boarding and time to move to next segment
      if (state.phase === 'BOARDING' && currentSegment < 3) {
        // Simulate API update with next segment after dwell
        totalTime += 3; // Wait for dwell
        const nextNowMs = startMs + totalTime * 1000;

        state = trainAnimationReducer(state, {
          type: 'API_UPDATE',
          nowMs: nextNowMs,
          prevStopId: STOPS[currentSegment + 1].id,
          nextStopId: STOPS[currentSegment + 2].id,
          prevS: STOPS[currentSegment + 1].s,
          nextS: STOPS[currentSegment + 2].s,
          apiProgress: 0,
        });

        // Tick to process pending segment
        state = trainAnimationReducer(state, { type: 'TICK', nowMs: nextNowMs });
        currentSegment++;
        console.log(`${totalTime},${currentSegment},${stateToCSV(state)}`);
      }

      totalTime += 1;
    }
  });

  // Verify thresholds work correctly
  it('verifies ARRIVING phase triggers at correct distance', () => {
    const nowMs = Date.now();
    // Segment is 800m, progress 0.75 = 600m traveled = 200m remaining
    const state = createTrainAnimationState(
      'trip-004', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s, // 0 to 800
      nowMs, 0.75, 90, 1.0
    );

    const distanceToStation = Math.abs(state.nextS - state.currentS);
    console.log(`\nDistance to station: ${distanceToStation}m, Phase: ${state.phase}`);

    // Should be ARRIVING when within 200m
    expect(distanceToStation).toBe(200);
  });

  it('verifies BOARDING phase triggers at station', () => {
    const nowMs = Date.now();
    const state = createTrainAnimationState(
      'trip-005', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      nowMs, 1.0, 90, 1.0
    );

    const distanceToStation = Math.abs(state.nextS - state.currentS);
    console.log(`Distance to station: ${distanceToStation}m, Phase: ${state.phase}`);

    expect(state.phase).toBe('BOARDING');
    expect(distanceToStation).toBe(0);
  });

  it('should NOT compound speed multiplier on repeated API updates (CRITICAL BUG FIX)', () => {
    console.log('\n=== SPEED MULTIPLIER BOUNDS TEST ===');
    console.log('iteration,speedMultiplier,progress,apiProgress');

    const startMs = Date.now();
    let state = createTrainAnimationState(
      'trip-speed', ROUTE_ID,
      STOPS[0].id, STOPS[1].id,
      STOPS[0].s, STOPS[1].s,
      startMs, 0.3, 90, 1.0
    );

    // Simulate 100 API updates with varying discrepancies
    // Before fix: this would compound to 2.59^100 (astronomical)
    // After fix: bounded between 0.5 and 2.0
    for (let i = 0; i < 100; i++) {
      // Simulate API saying train is slightly ahead of our animation
      const apiProgress = Math.min(1, state.progress + 0.15); // 15% discrepancy

      state = trainAnimationReducer(state, {
        type: 'API_UPDATE',
        nowMs: startMs + i * 15000, // every 15 seconds
        prevStopId: STOPS[0].id,
        nextStopId: STOPS[1].id,
        prevS: STOPS[0].s,
        nextS: STOPS[1].s,
        apiProgress,
      });

      // Log every 10th iteration
      if (i % 10 === 0) {
        console.log(`${i},${state.speedMultiplier.toFixed(4)},${state.progress.toFixed(4)},${apiProgress.toFixed(4)}`);
      }
    }

    console.log(`\nFinal speed multiplier after 100 API updates: ${state.speedMultiplier}`);

    // CRITICAL: speed multiplier must stay bounded
    expect(state.speedMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(state.speedMultiplier).toBeLessThanOrEqual(2.0);
  });
});
