/**
 * Integration tests for hooks working together
 *
 * These tests verify that hooks compose correctly in real-world scenarios
 * like the StationsPage which uses useStaticData, useTrainPositions, and useAlerts together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStaticData, useStationsByRoute, useSearchStations } from './use-static-data';
import { useTrainPositions } from './use-train-positions';
import { useAlerts } from './use-alerts';
import { QueryWrapper, createTestQueryClient, createQueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

// Mock alerts store
vi.mock('@/stores', () => ({
  useAlertsStore: () => ({
    dismissedIds: new Set<string>(),
    dismissAlert: vi.fn(),
    clearDismissed: vi.fn(),
  }),
}));

// Realistic test data
const mockStops = [
  { id: '101', name: 'Times Square', parent: null, routes: 'A,C,E,1,2,3,N,Q,R,S', lat: 40.7559, lon: -73.9871 },
  { id: '101N', name: 'Times Square', parent: '101', routes: 'A,C,E', lat: 40.7559, lon: -73.9871 },
  { id: '101S', name: 'Times Square', parent: '101', routes: 'A,C,E', lat: 40.7559, lon: -73.9871 },
  { id: '127', name: 'Penn Station', parent: null, routes: '1,2,3', lat: 40.7506, lon: -73.9935 },
  { id: '631', name: 'Grand Central', parent: null, routes: '4,5,6,S', lat: 40.7527, lon: -73.9772 },
  { id: '902', name: 'Court Sq', parent: null, routes: 'E,G,M', lat: 40.7473, lon: -73.9451 },
];

const mockRoutes = [
  { route_id: 'A', route_name: 'A 8th Ave Express', color: '#0039A6' },
  { route_id: '1', route_name: '1 Broadway-7th Ave Local', color: '#EE352E' },
  { route_id: 'E', route_name: 'E 8th Ave Local', color: '#0039A6' },
];

const mockEnriched = {
  '101': { enrichedName: 'Times Square-42 St', crossStreet: '42nd St & 7th Ave' },
  '127': { enrichedName: 'Penn Station-34 St', crossStreet: '34th St & 7th Ave' },
  '631': { enrichedName: 'Grand Central-42 St', crossStreet: '42nd St & Park Ave' },
};

const mockTrains = {
  trains: [
    { id: 'A-001', routeId: 'A', nextStopId: '101N', status: 'IN_TRANSIT' },
    { id: 'A-002', routeId: 'A', nextStopId: '101S', status: 'STOPPED' },
    { id: '1-001', routeId: '1', nextStopId: '127N', status: 'IN_TRANSIT' },
    { id: 'E-001', routeId: 'E', nextStopId: '902N', status: 'IN_TRANSIT' },
  ],
  updatedAt: new Date().toISOString(),
};

const mockAlerts = {
  alerts: [
    {
      id: 'alert-1',
      severity: 'warning',
      headerText: 'A train delays due to signal problems',
      affectedRoutes: ['A', 'C', 'E'],
      affectedStops: ['101N', '101S'],
      activePeriods: [{ start: new Date(Date.now() - 3600000).toISOString() }],
    },
    {
      id: 'alert-2',
      severity: 'info',
      headerText: 'Weekend service changes',
      affectedRoutes: ['1', '2', '3'],
      affectedStops: ['127N', '127S'],
      activePeriods: [{ start: new Date(Date.now() - 3600000).toISOString() }],
    },
  ],
};

function setupMocks() {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url === '/api/v1/stops') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStops) });
    }
    if (url === '/api/v1/routes') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRoutes) });
    }
    if (url === '/data/stations-enriched.json') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockEnriched) });
    }
    if (url === '/api/v1/trains') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTrains) });
    }
    if (url.includes('/api/v1/alerts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAlerts) });
    }
    return Promise.resolve({ ok: false });
  });
}

describe('Hook Integration: StationsPage scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('loads all data needed for stations page', async () => {
    // This test simulates what StationsPage does: load stations, trains, and alerts
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    // Render all hooks together like the page does
    const { result: staticResult } = renderHook(() => useStaticData(), { wrapper });
    const { result: trainsResult } = renderHook(() => useTrainPositions({ enabled: true }), { wrapper });
    const { result: alertsResult } = renderHook(() => useAlerts({ enabled: true }), { wrapper });

    // Wait for all data to load
    await waitFor(() => {
      expect(staticResult.current.isLoading).toBe(false);
      expect(trainsResult.current.isLoading).toBe(false);
      expect(alertsResult.current.isLoading).toBe(false);
    });

    // Verify stations data
    expect(Object.keys(staticResult.current.stations)).toHaveLength(6);
    expect(staticResult.current.stations['101'].enrichedName).toBe('Times Square-42 St');

    // Verify trains data
    expect(trainsResult.current.trains).toHaveLength(4);

    // Verify alerts data
    expect(alertsResult.current.alerts).toHaveLength(2);
  });

  it('correctly counts trains per station', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    const { result: staticResult } = renderHook(() => useStaticData(), { wrapper });
    const { result: trainsResult } = renderHook(() => useTrainPositions({ enabled: true }), { wrapper });

    await waitFor(() => {
      expect(staticResult.current.isLoading).toBe(false);
      expect(trainsResult.current.isLoading).toBe(false);
    });

    // Simulate the StationsPage logic for counting trains
    const trainsPerStation: Record<string, number> = {};
    for (const train of trainsResult.current.trains) {
      const stopId = train.nextStopId;
      const parentId = stopId?.replace(/[NS]$/, '');
      if (parentId) {
        trainsPerStation[parentId] = (trainsPerStation[parentId] || 0) + 1;
      }
    }

    // Times Square should have 2 trains (A-001 and A-002)
    expect(trainsPerStation['101']).toBe(2);
    // Penn Station should have 1 train
    expect(trainsPerStation['127']).toBe(1);
    // Court Sq should have 1 train
    expect(trainsPerStation['902']).toBe(1);
  });

  it('correctly identifies stations with alerts', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    const { result: alertsResult } = renderHook(() => useAlerts({ enabled: true }), { wrapper });

    await waitFor(() => {
      expect(alertsResult.current.isLoading).toBe(false);
    });

    // Simulate the StationsPage logic for finding stations with alerts
    const stationsWithAlerts = new Set<string>();
    for (const alert of alertsResult.current.alerts) {
      for (const stopId of alert.affectedStops) {
        const parentId = stopId?.replace(/[NS]$/, '');
        if (parentId) stationsWithAlerts.add(parentId);
      }
    }

    // Times Square (101) has alert-1
    expect(stationsWithAlerts.has('101')).toBe(true);
    // Penn Station (127) has alert-2
    expect(stationsWithAlerts.has('127')).toBe(true);
    // Grand Central and Court Sq have no alerts
    expect(stationsWithAlerts.has('631')).toBe(false);
    expect(stationsWithAlerts.has('902')).toBe(false);
  });
});

describe('Hook Integration: Route filtering scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('filters stations by route correctly', async () => {
    const { result } = renderHook(() => useStationsByRoute('A'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    // A train serves Times Square (101) and Court Sq (902)
    const stationIds = result.current.map((s) => s.id);
    expect(stationIds).toContain('101');
    expect(stationIds).not.toContain('127'); // Penn Station is 1,2,3 only
    expect(stationIds).not.toContain('631'); // Grand Central is 4,5,6,S
  });

  it('combines route filter with train data', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    // Filter for E train stations
    const { result: stationsResult } = renderHook(() => useStationsByRoute('E'), { wrapper });
    const { result: trainsResult } = renderHook(() => useTrainPositions({ enabled: true }), { wrapper });

    await waitFor(() => {
      expect(stationsResult.current.length).toBeGreaterThan(0);
      expect(trainsResult.current.isLoading).toBe(false);
    });

    // Get E train stations
    const eStationIds = new Set(stationsResult.current.map((s) => s.id));

    // Count E trains at E stations
    const eTrainsAtEStations = trainsResult.current.trains.filter((train) => {
      const parentId = train.nextStopId?.replace(/[NS]$/, '');
      return train.routeId === 'E' && parentId && eStationIds.has(parentId);
    });

    // E-001 is at Court Sq which is an E station
    expect(eTrainsAtEStations.length).toBeGreaterThan(0);
  });
});

describe('Hook Integration: Search scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('searches stations and shows related alerts', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    // Search for "Times Square"
    const { result: searchResult } = renderHook(() => useSearchStations('Times'), { wrapper });
    const { result: alertsResult } = renderHook(() => useAlerts({ enabled: true }), { wrapper });

    await waitFor(() => {
      expect(searchResult.current.length).toBeGreaterThan(0);
      expect(alertsResult.current.isLoading).toBe(false);
    });

    // Should find Times Square
    expect(searchResult.current.some((s) => s.id === '101')).toBe(true);

    // Check if found stations have alerts
    const foundStationIds = new Set(searchResult.current.map((s) => s.id));
    const alertsForFoundStations = alertsResult.current.alerts.filter((alert) =>
      alert.affectedStops.some((stopId) => {
        const parentId = stopId?.replace(/[NS]$/, '');
        return parentId && foundStationIds.has(parentId);
      })
    );

    // Times Square has alert-1
    expect(alertsForFoundStations.length).toBeGreaterThan(0);
    expect(alertsForFoundStations[0].id).toBe('alert-1');
  });

  it('search works with enriched station names', async () => {
    const { result } = renderHook(() => useSearchStations('42 St'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    // Should find Times Square and Grand Central via enriched names
    const stationIds = result.current.map((s) => s.id);
    expect(stationIds).toContain('101'); // Times Square-42 St
    expect(stationIds).toContain('631'); // Grand Central-42 St
  });
});

describe('Hook Integration: Data consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('uses same query cache across hooks', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    // Render useStaticData and useStationsByRoute
    renderHook(() => useStaticData(), { wrapper });
    renderHook(() => useStationsByRoute('A'), { wrapper });

    await waitFor(() => {
      // Stops should only be fetched once (shared cache)
      const stopsCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === '/api/v1/stops'
      );
      expect(stopsCalls.length).toBe(1);
    });
  });

  it('handles partial failures gracefully', async () => {
    // Make alerts fail while others succeed
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/stops') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStops) });
      }
      if (url === '/api/v1/routes') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRoutes) });
      }
      if (url === '/data/stations-enriched.json') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockEnriched) });
      }
      if (url === '/api/v1/trains') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTrains) });
      }
      if (url.includes('/api/v1/alerts')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ ok: false });
    });

    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    const { result: staticResult } = renderHook(() => useStaticData(), { wrapper });
    const { result: trainsResult } = renderHook(() => useTrainPositions({ enabled: true }), { wrapper });
    const { result: alertsResult } = renderHook(() => useAlerts({ enabled: true }), { wrapper });

    await waitFor(() => {
      expect(staticResult.current.isLoading).toBe(false);
      expect(trainsResult.current.isLoading).toBe(false);
    });

    // Static data and trains should work
    expect(Object.keys(staticResult.current.stations).length).toBeGreaterThan(0);
    expect(trainsResult.current.trains.length).toBeGreaterThan(0);

    // Alerts should have error but not crash
    expect(alertsResult.current.error).toBe('Network error');
    expect(alertsResult.current.alerts).toEqual([]);
  });
});
