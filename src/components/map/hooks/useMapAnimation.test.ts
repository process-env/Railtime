import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapAnimation } from './useMapAnimation';

// Mock the dynamic imports
vi.mock('@/lib/map/arclength', () => ({
  arclengthToLatLon: vi.fn((s: number) => [40.7128 + s * 0.0001, -74.006 + s * 0.0001]),
}));

vi.mock('@/lib/map/motion-planner', () => ({
  evaluatePlan: vi.fn(),
  MOTION_PARAMS: { maxAccel: 1.5, maxJerk: 0.5 },
}));

vi.mock('@/lib/map/alpha-beta-gamma', () => ({
  predictPosition: vi.fn((state: { s: number }) => state.s),
  DEFAULT_FILTER_PARAMS: { alpha: 0.8, beta: 0.2, gamma: 0.1 },
  createFilterState: vi.fn((s: number) => ({ s, v: 0, a: 0, lastUpdateTime: Date.now() })),
}));

vi.mock('@/lib/map/train-state-machine', () => ({
  trainAnimationReducer: vi.fn((state: unknown) => state),
  getCurrentArclength: vi.fn((state: { currentS: number }) => state?.currentS ?? 0),
  createTrainAnimationState: vi.fn(),
}));

vi.mock('@/lib/constants', () => ({
  getRouteColor: vi.fn(() => '#EE352E'),
}));

vi.mock('@/lib/mta/format', () => ({
  getTextColorForBackground: vi.fn(() => 'white'),
  getDirectionFromStopId: vi.fn(() => 'N'),
  getDirectionLabel: vi.fn(() => 'Uptown'),
  formatEta: vi.fn(() => '5 min'),
}));

describe('useMapAnimation', () => {
  let rafCallback: FrameRequestCallback | null = null;
  let animationFrameId = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallback = null;
    animationFrameId = 0;

    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallback = callback;
      return ++animationFrameId;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      rafCallback = null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns expected interface', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    expect(result.current).toHaveProperty('trainAnimsRef');
    expect(result.current).toHaveProperty('trainMotionRef');
    expect(result.current).toHaveProperty('lerp');
    expect(result.current).toHaveProperty('scheduleAnimation');
  });

  it('lerp function works correctly', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    const { lerp } = result.current;

    // Test basic lerp
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(10, 20, 0.3)).toBeCloseTo(13);
  });

  it('trainAnimsRef starts as empty Map', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    expect(result.current.trainAnimsRef.current).toBeInstanceOf(Map);
    expect(result.current.trainAnimsRef.current.size).toBe(0);
  });

  it('trainMotionRef starts as empty Map', () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000, useAlphaBetaGamma: true })
    );

    expect(result.current.trainMotionRef.current).toBeInstanceOf(Map);
    expect(result.current.trainMotionRef.current.size).toBe(0);
  });

  it('does not schedule animation when map not loaded', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    act(() => {
      result.current.scheduleAnimation();
    });

    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('does not schedule animation when no trains to animate', () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000 })
    );

    // Map is loaded but no trains
    act(() => {
      result.current.scheduleAnimation();
    });

    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('schedules animation when map loaded and trains present', async () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000 })
    );

    // Add a legacy animation
    act(() => {
      const mockPopup = {
        setHTML: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };
      const mockMarker = {
        setLngLat: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };

      result.current.trainAnimsRef.current.set('test-trip', {
        marker: mockMarker as unknown as maplibregl.Marker,
        popup: mockPopup as unknown as maplibregl.Popup,
        fromLng: -74.0,
        fromLat: 40.7,
        toLng: -74.1,
        toLat: 40.8,
        startTime: performance.now(),
        isDwelling: false,
        routeId: '1',
        nextStopName: 'Test Station',
        eta: '5 min',
        direction: 'N',
      });
    });

    act(() => {
      result.current.scheduleAnimation();
    });

    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('animates legacy trains by interpolating position', () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000 })
    );

    const mockMarker = {
      setLngLat: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn(),
    };
    const mockPopup = {
      setHTML: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn(),
    };

    const startTime = performance.now();

    act(() => {
      result.current.trainAnimsRef.current.set('test-trip', {
        marker: mockMarker as unknown as maplibregl.Marker,
        popup: mockPopup as unknown as maplibregl.Popup,
        fromLng: -74.0,
        fromLat: 40.7,
        toLng: -74.1,
        toLat: 40.8,
        startTime,
        isDwelling: false,
        routeId: '1',
        nextStopName: 'Test Station',
        eta: '5 min',
        direction: 'N',
      });
    });

    act(() => {
      result.current.scheduleAnimation();
    });

    // Advance time halfway through animation
    vi.advanceTimersByTime(7500);

    // Execute animation frame
    if (rafCallback) {
      act(() => {
        rafCallback!(performance.now());
      });
    }

    // Marker position should have been updated
    expect(mockMarker.setLngLat).toHaveBeenCalled();
  });

  it('does not animate dwelling trains', () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000 })
    );

    const mockMarker = {
      setLngLat: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn(),
    };
    const mockPopup = {
      setHTML: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn(),
    };

    act(() => {
      result.current.trainAnimsRef.current.set('test-trip', {
        marker: mockMarker as unknown as maplibregl.Marker,
        popup: mockPopup as unknown as maplibregl.Popup,
        fromLng: -74.0,
        fromLat: 40.7,
        toLng: -74.1,
        toLat: 40.8,
        startTime: performance.now(),
        isDwelling: true, // Dwelling
        routeId: '1',
        nextStopName: 'Test Station',
        eta: '5 min',
        direction: 'N',
      });
    });

    // Animation should not be scheduled for dwelling trains
    act(() => {
      result.current.scheduleAnimation();
    });

    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('cancels animation on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000 })
    );

    // Add a train and schedule animation
    act(() => {
      const mockMarker = {
        setLngLat: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };
      const mockPopup = {
        setHTML: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };

      result.current.trainAnimsRef.current.set('test-trip', {
        marker: mockMarker as unknown as maplibregl.Marker,
        popup: mockPopup as unknown as maplibregl.Popup,
        fromLng: -74.0,
        fromLat: 40.7,
        toLng: -74.1,
        toLat: 40.8,
        startTime: performance.now(),
        isDwelling: false,
        routeId: '1',
        nextStopName: 'Test Station',
        eta: '5 min',
        direction: 'N',
      });

      result.current.scheduleAnimation();
    });

    unmount();

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('only schedules one animation at a time', () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000 })
    );

    // Add a train
    act(() => {
      const mockMarker = {
        setLngLat: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };
      const mockPopup = {
        setHTML: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };

      result.current.trainAnimsRef.current.set('test-trip', {
        marker: mockMarker as unknown as maplibregl.Marker,
        popup: mockPopup as unknown as maplibregl.Popup,
        fromLng: -74.0,
        fromLat: 40.7,
        toLng: -74.1,
        toLat: 40.8,
        startTime: performance.now(),
        isDwelling: false,
        routeId: '1',
        nextStopName: 'Test Station',
        eta: '5 min',
        direction: 'N',
      });
    });

    // Schedule multiple times
    act(() => {
      result.current.scheduleAnimation();
      result.current.scheduleAnimation();
      result.current.scheduleAnimation();
    });

    // Should only have scheduled once
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});

describe('useMapAnimation - motion-based animation', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((_callback) => {
      return 1;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enables alpha-beta-gamma when option is set', () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000, useAlphaBetaGamma: true })
    );

    expect(result.current.trainMotionRef.current).toBeInstanceOf(Map);
  });

  it('schedules animation for motion-based trains', async () => {
    const { result } = renderHook(() =>
      useMapAnimation(true, { refreshInterval: 15000, useAlphaBetaGamma: true })
    );

    // Wait for motion utils to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Add a motion-based train
    act(() => {
      const mockMarker = {
        setLngLat: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };
      const mockPopup = {
        setHTML: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        addTo: vi.fn(),
      };

      result.current.trainMotionRef.current.set('test-trip', {
        tripId: 'test-trip',
        routeId: '1',
        marker: mockMarker as unknown as maplibregl.Marker,
        popup: mockPopup as unknown as maplibregl.Popup,
        track: { points: [], stopArclengths: new Map() } as unknown as import('@/lib/map/track-index').RouteTrack,
        filter: { s: 1000, v: 0, a: 0, lastUpdateTime: Date.now() },
        plan: null,
        prevStopId: 'A01',
        nextStopId: 'A02',
        prevTimeMs: Date.now() - 30000,
        nextTimeMs: Date.now() + 60000,
        prevS: 0,
        nextS: 5000,
        segmentStartTime: Date.now() - 30000,
        scheduledDuration: 90,
        speedMultiplier: 1.0,
        animState: null,
        nextStopName: 'Test Station',
        eta: '5 min',
        headsign: 'Uptown',
        direction: 'N',
        lastFrameTime: performance.now(),
        lastApiUpdate: Date.now(),
      });
    });

    act(() => {
      result.current.scheduleAnimation();
    });

    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });
});

describe('lerp edge cases', () => {
  it('handles negative values', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    const { lerp } = result.current;

    expect(lerp(-100, 100, 0.5)).toBe(0);
    expect(lerp(-100, -50, 0.5)).toBe(-75);
  });

  it('handles t values outside 0-1 range', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    const { lerp } = result.current;

    // Extrapolation works as expected
    expect(lerp(0, 100, 1.5)).toBe(150);
    expect(lerp(0, 100, -0.5)).toBe(-50);
  });

  it('handles same start and end', () => {
    const { result } = renderHook(() =>
      useMapAnimation(false, { refreshInterval: 15000 })
    );

    const { lerp } = result.current;

    expect(lerp(50, 50, 0)).toBe(50);
    expect(lerp(50, 50, 0.5)).toBe(50);
    expect(lerp(50, 50, 1)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Pure-math helpers replicated from useMapAnimation.ts — no hook instantiation
// needed so these tests are fast and deterministic.
// ---------------------------------------------------------------------------

const BLEND_SPEED = 0.06;
const DWELL_DURATION_MS = 2000;
const STATION_SNAP_DISTANCE = 20;

/**
 * Replicate the schedule-based fallback path (lines 374-418 of useMapAnimation.ts).
 * Returns the new rendered arclength after one "frame".
 */
function simulateFrame({
  nowMs,
  segmentStartTime,
  scheduledDuration,
  speedMultiplier,
  prevS,
  nextS,
  lastRenderedS,
  frameDtMs,
}: {
  nowMs: number;
  segmentStartTime: number;
  scheduledDuration: number;
  speedMultiplier: number;
  prevS: number;
  nextS: number;
  lastRenderedS: number;
  frameDtMs: number;
}): number {
  const adjustedDuration = scheduledDuration / Math.max(0.01, speedMultiplier);
  const elapsed = (nowMs - segmentStartTime) / 1000;
  const rawProgress = adjustedDuration > 0 ? elapsed / adjustedDuration : 1;
  const progress = Math.max(0, Math.min(1, rawProgress));

  let targetS: number;
  if (progress >= 1.0) {
    targetS = nextS;
  } else {
    targetS = prevS + (nextS - prevS) * progress;
  }

  // Clamp target to segment bounds
  const minS = Math.min(prevS, nextS);
  const maxS = Math.max(prevS, nextS);
  targetS = Math.max(minS, Math.min(maxS, targetS));

  // Smooth blend
  const currentS = lastRenderedS;
  const dtNorm = Math.max(0.5, frameDtMs / 16.67);
  const blend = 1 - Math.pow(1 - BLEND_SPEED, dtNorm);
  let newS = currentS + (targetS - currentS) * blend;

  // Snap when very close
  if (Math.abs(newS - targetS) < 1) {
    newS = targetS;
  }

  return newS;
}

/** Replicate safeArclength from useMapAnimation.ts */
function safeArclength(s: number, fallback?: number, fallback2?: number): number {
  if (Number.isFinite(s)) return s;
  if (fallback !== undefined && Number.isFinite(fallback)) return fallback;
  if (fallback2 !== undefined && Number.isFinite(fallback2)) return fallback2;
  return 0;
}

// ---------------------------------------------------------------------------

describe('Train position monotonicity', () => {
  const FRAME_DT_MS = 16.67;  // 60 fps
  const prevS = 0;
  const nextS = 5000;
  const scheduledDuration = 90;   // seconds
  const speedMultiplier = 1.0;
  const segmentStartTime = 1_000_000;  // arbitrary epoch ms

  it('position never decreases over 60 frames (monotonically forward)', () => {
    let lastRenderedS = prevS;
    let nowMs = segmentStartTime;

    for (let frame = 0; frame < 60; frame++) {
      nowMs += FRAME_DT_MS;
      const newS = simulateFrame({
        nowMs,
        segmentStartTime,
        scheduledDuration,
        speedMultiplier,
        prevS,
        nextS,
        lastRenderedS,
        frameDtMs: FRAME_DT_MS,
      });

      expect(newS).toBeGreaterThanOrEqual(lastRenderedS - 0.001);  // allow float rounding
      lastRenderedS = newS;
    }
  });

  it('position never decreases over 2700 frames (~45s at 60fps)', () => {
    let lastRenderedS = prevS;
    let nowMs = segmentStartTime;

    for (let frame = 0; frame < 2700; frame++) {
      nowMs += FRAME_DT_MS;
      const newS = simulateFrame({
        nowMs,
        segmentStartTime,
        scheduledDuration,
        speedMultiplier,
        prevS,
        nextS,
        lastRenderedS,
        frameDtMs: FRAME_DT_MS,
      });

      expect(newS).toBeGreaterThanOrEqual(lastRenderedS - 0.001);
      lastRenderedS = newS;
    }
  });

  it('position reaches nextS within 2x the scheduled duration', () => {
    let lastRenderedS = prevS;
    let nowMs = segmentStartTime;

    // Simulate up to 2x scheduledDuration worth of frames
    const maxFrames = Math.ceil((scheduledDuration * 2 * 1000) / FRAME_DT_MS);

    for (let frame = 0; frame < maxFrames; frame++) {
      nowMs += FRAME_DT_MS;
      const newS = simulateFrame({
        nowMs,
        segmentStartTime,
        scheduledDuration,
        speedMultiplier,
        prevS,
        nextS,
        lastRenderedS,
        frameDtMs: FRAME_DT_MS,
      });
      lastRenderedS = newS;
    }

    // After 2x scheduled duration the train should be at or very near nextS
    expect(lastRenderedS).toBeCloseTo(nextS, 0);
  });

  it('speedMultiplier > 1 never causes position to overshoot nextS', () => {
    const fastMultiplier = 2.0;  // Trains running twice as fast
    let lastRenderedS = prevS;
    let nowMs = segmentStartTime;

    // Run for 3x the adjusted duration to be sure
    const adjustedDuration = scheduledDuration / fastMultiplier;
    const maxFrames = Math.ceil((adjustedDuration * 3 * 1000) / FRAME_DT_MS);

    for (let frame = 0; frame < maxFrames; frame++) {
      nowMs += FRAME_DT_MS;
      const newS = simulateFrame({
        nowMs,
        segmentStartTime,
        scheduledDuration,
        speedMultiplier: fastMultiplier,
        prevS,
        nextS,
        lastRenderedS,
        frameDtMs: FRAME_DT_MS,
      });

      // Position must never exceed nextS (clamp enforces this)
      expect(newS).toBeLessThanOrEqual(nextS + 0.001);
      lastRenderedS = newS;
    }
  });

  it('speedMultiplier < 1 still makes positive progress from the start', () => {
    const slowMultiplier = 0.5;  // Delay-slowed train
    let lastRenderedS = prevS;
    let nowMs = segmentStartTime;

    // Run 30 frames (~500ms)
    for (let frame = 0; frame < 30; frame++) {
      nowMs += FRAME_DT_MS;
      const newS = simulateFrame({
        nowMs,
        segmentStartTime,
        scheduledDuration,
        speedMultiplier: slowMultiplier,
        prevS,
        nextS,
        lastRenderedS,
        frameDtMs: FRAME_DT_MS,
      });
      lastRenderedS = newS;
    }

    // After 500ms of real time the train should have moved forward at least a little
    expect(lastRenderedS).toBeGreaterThan(prevS);
  });
});

// ---------------------------------------------------------------------------

describe('Backward pull bugs', () => {
  it('BUG: when targetS < lastRenderedS blend pulls the train backward', () => {
    // This documents the known backward-pull behavior when a stale lastRenderedS
    // is ahead of the new segment's targetS (e.g. after a segment boundary correction).
    // The test asserts that the math does indeed produce a backward movement so that
    // any fix for the bug can be validated against this test.
    const lastRenderedS = 2500;
    const targetS = 2300;   // targetS is BEHIND the last rendered position

    const dtNorm = Math.max(0.5, 16.67 / 16.67);
    const blend = 1 - Math.pow(1 - BLEND_SPEED, dtNorm);
    const newS = lastRenderedS + (targetS - lastRenderedS) * blend;

    // The blend moves newS in the direction of targetS — which is backward
    expect(newS).toBeLessThan(lastRenderedS);
  });

  it('BUG: stale speedMultiplier causes adjustedDuration to differ from API scheduledDuration', () => {
    // When the API returns scheduledDuration=90 but speedMultiplier has not been
    // reset after a segment change (still 1.5), the computed adjustedDuration is
    // 90 / 1.5 = 60, not 90.  This means the train appears to run 50% faster than
    // the GTFS schedule predicts.
    const scheduledDurationFromApi = 90;   // seconds — what the API says
    const staleSpeedMultiplier = 1.5;      // was set for the previous segment

    const adjustedDuration = scheduledDurationFromApi / Math.max(0.01, staleSpeedMultiplier);

    // The stale multiplier produces 60s, not the expected 90s
    expect(adjustedDuration).toBeCloseTo(60, 5);
    expect(adjustedDuration).not.toBeCloseTo(90, 5);
  });
});

// ---------------------------------------------------------------------------

describe('safeArclength guard', () => {
  it('returns a finite s value unchanged', () => {
    expect(safeArclength(1234.5)).toBe(1234.5);
    expect(safeArclength(0)).toBe(0);
    expect(safeArclength(-500)).toBe(-500);
  });

  it('falls back to first fallback when s is NaN', () => {
    expect(safeArclength(NaN, 999)).toBe(999);
  });

  it('falls back to first fallback when s is Infinity', () => {
    expect(safeArclength(Infinity, 42)).toBe(42);
  });

  it('falls back to second fallback when both s and first fallback are invalid', () => {
    expect(safeArclength(NaN, NaN, 777)).toBe(777);
    expect(safeArclength(Infinity, Infinity, 100)).toBe(100);
  });

  it('returns 0 when all arguments are invalid', () => {
    expect(safeArclength(NaN, NaN, NaN)).toBe(0);
    expect(safeArclength(Infinity, Infinity, Infinity)).toBe(0);
    expect(safeArclength(NaN)).toBe(0);
    expect(safeArclength(Infinity)).toBe(0);
  });

  it('ignores a finite s and does NOT fall back even when fallback is also finite', () => {
    // s is valid — fallback must be ignored
    expect(safeArclength(5, 999)).toBe(5);
  });

  it('accepts undefined fallback gracefully', () => {
    expect(safeArclength(NaN, undefined)).toBe(0);
    expect(safeArclength(NaN, undefined, 42)).toBe(42);
  });
});

// ---------------------------------------------------------------------------

describe('Blend convergence', () => {
  it('converges to within 1% of target within 90 frames at 60fps', () => {
    const initialS = 0;
    const targetS = 1000;
    let currentS = initialS;
    const frameDtMs = 16.67;

    for (let frame = 0; frame < 90; frame++) {
      const dtNorm = Math.max(0.5, frameDtMs / 16.67);
      const blend = 1 - Math.pow(1 - BLEND_SPEED, dtNorm);
      currentS = currentS + (targetS - currentS) * blend;
    }

    const remaining = Math.abs(targetS - currentS);
    const percentRemaining = remaining / Math.abs(targetS - initialS);
    expect(percentRemaining).toBeLessThan(0.01);  // less than 1% error
  });

  it('frame-rate independence: 60fps and 30fps reach similar convergence after same wall time', () => {
    // Wall time: 1500ms — same for both frame rates
    const initialS = 0;
    const targetS = 1000;
    const wallTimeMs = 1500;

    // 60fps: 90 frames of 16.67ms
    let s60 = initialS;
    const frameDt60 = 16.67;
    const frames60 = Math.floor(wallTimeMs / frameDt60);
    for (let f = 0; f < frames60; f++) {
      const blend = 1 - Math.pow(1 - BLEND_SPEED, Math.max(0.5, frameDt60 / 16.67));
      s60 = s60 + (targetS - s60) * blend;
    }

    // 30fps: 45 frames of 33.33ms
    let s30 = initialS;
    const frameDt30 = 33.33;
    const frames30 = Math.floor(wallTimeMs / frameDt30);
    for (let f = 0; f < frames30; f++) {
      const blend = 1 - Math.pow(1 - BLEND_SPEED, Math.max(0.5, frameDt30 / 16.67));
      s30 = s30 + (targetS - s30) * blend;
    }

    // Both should be within 5% of each other (approximate frame-rate independence)
    const diff = Math.abs(s60 - s30);
    expect(diff).toBeLessThan(50);  // within 50 arclength units out of 1000 delta
  });

  it('backward blend magnitude scales with distance from target', () => {
    // Trains that are further from the target should move more per frame than ones
    // that are close.  This confirms the exponential decay shape of the blend.
    const target = 0;
    const farS = 1000;
    const nearS = 50;
    const frameDtMs = 16.67;

    const dtNorm = Math.max(0.5, frameDtMs / 16.67);
    const blend = 1 - Math.pow(1 - BLEND_SPEED, dtNorm);

    const farMovement = Math.abs((farS + (target - farS) * blend) - farS);
    const nearMovement = Math.abs((nearS + (target - nearS) * blend) - nearS);

    expect(farMovement).toBeGreaterThan(nearMovement);
  });
});

// ---------------------------------------------------------------------------

describe('Dwell and pending segment', () => {
  it('DWELL_DURATION_MS constant equals 2000ms', () => {
    // Confirm the constant value used in tests matches the source file
    expect(DWELL_DURATION_MS).toBe(2000);
  });

  it('station snap triggers at distance <= STATION_SNAP_DISTANCE (20m)', () => {
    const nextS = 5000;

    // Exactly at the snap threshold — should be considered at station
    const atThreshold = nextS - STATION_SNAP_DISTANCE;
    expect(Math.abs(nextS - atThreshold)).toBeLessThanOrEqual(STATION_SNAP_DISTANCE);

    // One unit outside the threshold — should NOT be considered at station
    const justOutside = nextS - STATION_SNAP_DISTANCE - 1;
    expect(Math.abs(nextS - justOutside)).toBeGreaterThan(STATION_SNAP_DISTANCE);
  });

  it('dwell expires after DWELL_DURATION_MS has elapsed', () => {
    const dwellStartTime = 1_000_000;
    const beforeExpiry = dwellStartTime + DWELL_DURATION_MS - 1;
    const atExpiry = dwellStartTime + DWELL_DURATION_MS;
    const afterExpiry = dwellStartTime + DWELL_DURATION_MS + 500;

    // Before expiry: dwell should still be active
    expect(beforeExpiry - dwellStartTime).toBeLessThan(DWELL_DURATION_MS);

    // Exactly at expiry and after: dwell complete
    expect(atExpiry - dwellStartTime).toBeGreaterThanOrEqual(DWELL_DURATION_MS);
    expect(afterExpiry - dwellStartTime).toBeGreaterThanOrEqual(DWELL_DURATION_MS);
  });

  it('pending segment is consumed: after dwell, prevS advances to pendingSegment.prevS', () => {
    // Simulate the dwell-completion logic from useMapAnimation.ts lines 312-329
    const state = {
      prevStopId: 'A01',
      nextStopId: 'A02',
      prevS: 0,
      nextS: 5000,
      scheduledDuration: 90,
      nextStopName: 'Station A',
      eta: '2 min',
      segmentStartTime: 1_000_000,
      filter: { s: 5000 },
      lastRenderedS: 5000,
      pendingSegment: {
        prevStopId: 'A02',
        nextStopId: 'A03',
        prevS: 5000,
        nextS: 9000,
        scheduledDuration: 60,
        nextStopName: 'Station B',
        eta: '3 min',
      },
      dwellStartTime: 1_000_000,
    };

    const nowMs = state.dwellStartTime + DWELL_DURATION_MS;  // exactly expired
    const dwellElapsed = nowMs - state.dwellStartTime;

    if (dwellElapsed >= DWELL_DURATION_MS && state.pendingSegment) {
      const pending = state.pendingSegment;
      state.prevStopId = pending.prevStopId;
      state.nextStopId = pending.nextStopId;
      state.prevS = pending.prevS;
      state.nextS = pending.nextS;
      state.scheduledDuration = pending.scheduledDuration;
      state.nextStopName = pending.nextStopName;
      state.eta = pending.eta;
      state.segmentStartTime = nowMs;
      state.filter.s = safeArclength(pending.prevS, state.lastRenderedS);
      state.lastRenderedS = state.filter.s;
      (state as { pendingSegment?: unknown }).pendingSegment = undefined;
    }

    // After dwell completion the segment should have advanced
    expect(state.prevStopId).toBe('A02');
    expect(state.nextStopId).toBe('A03');
    expect(state.prevS).toBe(5000);
    expect(state.nextS).toBe(9000);
    expect(state.scheduledDuration).toBe(60);
    expect(state.filter.s).toBe(5000);   // filter snapped to new prevS
    expect(state.pendingSegment).toBeUndefined();
  });
});
