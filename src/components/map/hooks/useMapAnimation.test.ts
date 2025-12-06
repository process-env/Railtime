import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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
  createFilterState: vi.fn((s: number) => ({ s, v: 0, a: 0, lastT: Date.now() })),
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

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
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
        filter: { s: 1000, v: 0, a: 0, lastT: Date.now() },
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
