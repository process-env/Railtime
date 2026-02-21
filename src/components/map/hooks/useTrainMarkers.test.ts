import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TrainPosition } from '@/types/mta';

// Mock maplibre-gl
vi.mock('maplibre-gl', () => ({
  default: {
    Marker: vi.fn().mockImplementation(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      setPopup: vi.fn().mockReturnThis(),
      togglePopup: vi.fn().mockReturnThis(),
    })),
    Popup: vi.fn().mockImplementation(() => ({
      setHTML: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
    })),
  },
}));

// Mock stores
vi.mock('@/stores', () => ({
  useUIStore: {
    getState: vi.fn(() => ({ selectedTrainId: null })),
  },
}));

// Mock constants
vi.mock('@/lib/constants', () => ({
  getRouteColor: vi.fn(() => '#EE352E'),
  MAP_CONSTANTS: {
    DWELLING_THRESHOLD: 0.0001,
    POPUP_OFFSET_TRAIN: [0, -15],
  },
}));

// Mock format utilities
vi.mock('@/lib/mta/format', () => ({
  getDirectionFromStopId: vi.fn((stopId: string) => (stopId.includes('N') ? 'N' : 'S')),
  formatEta: vi.fn(() => '5 min'),
  getDirectionLabel: vi.fn(() => 'Uptown'),
  getTextColorForBackground: vi.fn(() => 'white'),
}));

// Import hook after mocks are set up
import { useTrainMarkers } from './useTrainMarkers';
import type { TrainAnimState, TrainMotionState } from './useMapAnimation';

describe('useTrainMarkers', () => {
  // Create refs that mimic what useMapAnimation provides
  const createMockRefs = () => ({
    trainAnimsRef: { current: new Map<string, TrainAnimState>() },
    trainMotionRef: { current: new Map<string, TrainMotionState>() },
  });

  const mockLerp = (start: number, end: number, t: number) => start + (end - start) * t;
  const mockScheduleAnimation = vi.fn();
  const mockSetSelectedTrain = vi.fn();

  const createMockMap = () => ({
    isLoaded: () => true,
    on: vi.fn(),
    off: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns expected interface', () => {
    const refs = createMockRefs();

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current).toHaveProperty('visibleTrainCount');
    expect(result.current).toHaveProperty('latestApiDataRef');
    expect(result.current).toHaveProperty('getTrainPhase');
  });

  it('returns 0 visible trains when trains array is empty', () => {
    const refs = createMockRefs();

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.visibleTrainCount).toBe(0);
  });

  it('counts all trains when no route filter is applied', () => {
    const refs = createMockRefs();
    const trains: TrainPosition[] = [
      {
        tripId: 'trip1',
        routeId: '1',
        lat: 40.7128,
        lon: -74.006,
        nextStopId: 'A01N',
        nextStopName: 'Station 1',
        eta: '5 min',
        prevStopId: 'A00N',
        headsign: 'Uptown',
        heading: 0,
      },
      {
        tripId: 'trip2',
        routeId: '2',
        lat: 40.7228,
        lon: -74.016,
        nextStopId: 'B01N',
        nextStopName: 'Station 2',
        eta: '3 min',
        prevStopId: 'B00N',
        headsign: 'Downtown',
        heading: 0,
      },
      {
        tripId: 'trip3',
        routeId: '3',
        lat: 40.7328,
        lon: -74.026,
        nextStopId: 'C01N',
        nextStopName: 'Station 3',
        eta: '7 min',
        prevStopId: 'C00N',
        headsign: 'Express',
        heading: 0,
      },
    ];

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains,
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.visibleTrainCount).toBe(3);
  });

  it('filters trains by selected route', () => {
    const refs = createMockRefs();
    const trains: TrainPosition[] = [
      {
        tripId: 'trip1',
        routeId: '1',
        lat: 40.7128,
        lon: -74.006,
        nextStopId: 'A01N',
        nextStopName: 'Station 1',
        eta: '5 min',
        prevStopId: 'A00N',
        headsign: 'Uptown',
        heading: 0,
      },
      {
        tripId: 'trip2',
        routeId: '2',
        lat: 40.7228,
        lon: -74.016,
        nextStopId: 'B01N',
        nextStopName: 'Station 2',
        eta: '3 min',
        prevStopId: 'B00N',
        headsign: 'Downtown',
        heading: 0,
      },
      {
        tripId: 'trip3',
        routeId: '1',
        lat: 40.7328,
        lon: -74.026,
        nextStopId: 'C01N',
        nextStopName: 'Station 3',
        eta: '7 min',
        prevStopId: 'C00N',
        headsign: 'Express',
        heading: 0,
      },
    ];

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains,
          selectedRouteIds: ['1'],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.visibleTrainCount).toBe(2);
  });

  it('getTrainPhase returns null for unknown train', () => {
    const refs = createMockRefs();

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.getTrainPhase('unknown-trip')).toBeNull();
  });

  it('latestApiDataRef is a Map', () => {
    const refs = createMockRefs();

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.latestApiDataRef.current).toBeInstanceOf(Map);
  });

  it('visible count updates when trains change', () => {
    const refs = createMockRefs();
    const initialTrains: TrainPosition[] = [
      {
        tripId: 'trip1',
        routeId: '1',
        lat: 40.7128,
        lon: -74.006,
        nextStopId: 'A01N',
        nextStopName: 'Station 1',
        eta: '5 min',
        prevStopId: 'A00N',
        headsign: 'Uptown',
        heading: 0,
      },
    ];

    const { result, rerender } = renderHook(
      ({ trains }) =>
        useTrainMarkers(
          null,
          false,
          refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
          refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
          mockLerp,
          {
            trains,
            selectedRouteIds: [],
            selectedTrainId: null,
            setSelectedTrain: mockSetSelectedTrain,
            refreshInterval: 15000,
            scheduleAnimation: mockScheduleAnimation,
          }
        ),
      { initialProps: { trains: initialTrains } }
    );

    expect(result.current.visibleTrainCount).toBe(1);

    // Add more trains
    const moreTrains: TrainPosition[] = [
      ...initialTrains,
      {
        tripId: 'trip2',
        routeId: '2',
        lat: 40.7228,
        lon: -74.016,
        nextStopId: 'B01N',
        nextStopName: 'Station 2',
        eta: '3 min',
        prevStopId: 'B00N',
        headsign: 'Downtown',
        heading: 0,
      },
    ];

    rerender({ trains: moreTrains });

    expect(result.current.visibleTrainCount).toBe(2);
  });

  it('visible count updates when route filter changes', () => {
    const refs = createMockRefs();
    const trains: TrainPosition[] = [
      {
        tripId: 'trip1',
        routeId: '1',
        lat: 40.7128,
        lon: -74.006,
        nextStopId: 'A01N',
        nextStopName: 'Station 1',
        eta: '5 min',
        prevStopId: 'A00N',
        headsign: 'Uptown',
        heading: 0,
      },
      {
        tripId: 'trip2',
        routeId: '2',
        lat: 40.7228,
        lon: -74.016,
        nextStopId: 'B01N',
        nextStopName: 'Station 2',
        eta: '3 min',
        prevStopId: 'B00N',
        headsign: 'Downtown',
        heading: 0,
      },
    ];

    const { result, rerender } = renderHook(
      ({ selectedRouteIds }) =>
        useTrainMarkers(
          null,
          false,
          refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
          refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
          mockLerp,
          {
            trains,
            selectedRouteIds,
            selectedTrainId: null,
            setSelectedTrain: mockSetSelectedTrain,
            refreshInterval: 15000,
            scheduleAnimation: mockScheduleAnimation,
          }
        ),
      { initialProps: { selectedRouteIds: [] as string[] } }
    );

    expect(result.current.visibleTrainCount).toBe(2);

    // Filter to only route 1
    rerender({ selectedRouteIds: ['1'] });

    expect(result.current.visibleTrainCount).toBe(1);
  });

  it('handles case-insensitive route matching', () => {
    const refs = createMockRefs();
    const trains: TrainPosition[] = [
      {
        tripId: 'trip1',
        routeId: 'a', // lowercase
        lat: 40.7128,
        lon: -74.006,
        nextStopId: 'A01N',
        nextStopName: 'Station 1',
        eta: '5 min',
        prevStopId: 'A00N',
        headsign: 'Uptown',
        heading: 0,
      },
    ];

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains,
          selectedRouteIds: ['A'], // uppercase filter
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.visibleTrainCount).toBe(1);
  });
});

describe('Phase detection', () => {
  // Test the getPhaseFromDistance logic by checking motion states
  const createMockRefs = () => ({
    trainAnimsRef: { current: new Map<string, TrainAnimState>() },
    trainMotionRef: { current: new Map<string, TrainMotionState>() },
  });

  const mockLerp = (start: number, end: number, t: number) => start + (end - start) * t;
  const mockScheduleAnimation = vi.fn();
  const mockSetSelectedTrain = vi.fn();

  it('getTrainPhase returns phase from motion state lastPhase', () => {
    const refs = createMockRefs();

    // Add a motion state with a known phase
    const mockMarker = {
      setLngLat: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      togglePopup: vi.fn().mockReturnThis(),
    };
    const mockPopup = {
      setHTML: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
    };

    refs.trainMotionRef.current.set('trip-boarding', {
      tripId: 'trip-boarding',
      routeId: '1',
      marker: mockMarker as unknown as maplibregl.Marker,
      popup: mockPopup as unknown as maplibregl.Popup,
      track: null,
      filter: { s: 1000, v: 0, a: 0, lastUpdateTime: Date.now() },
      plan: null,
      prevStopId: 'A01',
      nextStopId: 'A02',
      prevTimeMs: Date.now() - 30000,
      nextTimeMs: Date.now() + 60000,
      prevS: 0,
      nextS: 1010, // 10m away = BOARDING
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
      lastPhase: 'BOARDING',
    });

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    expect(result.current.getTrainPhase('trip-boarding')).toBe('BOARDING');
  });

  it('getTrainPhase calculates phase from distance when lastPhase not set', () => {
    const refs = createMockRefs();

    const mockMarker = {
      setLngLat: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      togglePopup: vi.fn().mockReturnThis(),
    };
    const mockPopup = {
      setHTML: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
    };

    // Train at 1000m, station at 1500m (500m away = APPROACHING)
    refs.trainMotionRef.current.set('trip-approaching', {
      tripId: 'trip-approaching',
      routeId: '1',
      marker: mockMarker as unknown as maplibregl.Marker,
      popup: mockPopup as unknown as maplibregl.Popup,
      track: null,
      filter: { s: 1000, v: 0, a: 0, lastUpdateTime: Date.now() },
      plan: null,
      prevStopId: 'A01',
      nextStopId: 'A02',
      prevTimeMs: Date.now() - 30000,
      nextTimeMs: Date.now() + 60000,
      prevS: 0,
      nextS: 1500, // 500m away = APPROACHING
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
      // Note: no lastPhase set
    });

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    // Should calculate APPROACHING from distance (500m > 200m threshold)
    expect(result.current.getTrainPhase('trip-approaching')).toBe('APPROACHING');
  });

  it('getTrainPhase returns ARRIVING when within 200m', () => {
    const refs = createMockRefs();

    const mockMarker = {
      setLngLat: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      togglePopup: vi.fn().mockReturnThis(),
    };
    const mockPopup = {
      setHTML: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
    };

    // Train at 1000m, station at 1100m (100m away = ARRIVING)
    refs.trainMotionRef.current.set('trip-arriving', {
      tripId: 'trip-arriving',
      routeId: '1',
      marker: mockMarker as unknown as maplibregl.Marker,
      popup: mockPopup as unknown as maplibregl.Popup,
      track: null,
      filter: { s: 1000, v: 0, a: 0, lastUpdateTime: Date.now() },
      plan: null,
      prevStopId: 'A01',
      nextStopId: 'A02',
      prevTimeMs: Date.now() - 30000,
      nextTimeMs: Date.now() + 60000,
      prevS: 0,
      nextS: 1100, // 100m away = ARRIVING
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

    const { result } = renderHook(() =>
      useTrainMarkers(
        null,
        false,
        refs.trainAnimsRef as React.MutableRefObject<Map<string, TrainAnimState>>,
        refs.trainMotionRef as React.MutableRefObject<Map<string, TrainMotionState>>,
        mockLerp,
        {
          trains: [],
          selectedRouteIds: [],
          selectedTrainId: null,
          setSelectedTrain: mockSetSelectedTrain,
          refreshInterval: 15000,
          scheduleAnimation: mockScheduleAnimation,
        }
      )
    );

    // Should calculate ARRIVING from distance (100m < 200m threshold)
    expect(result.current.getTrainPhase('trip-arriving')).toBe('ARRIVING');
  });
});
