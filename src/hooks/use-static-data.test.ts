import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStaticData, useStationsByRoute, useSearchStations } from './use-static-data';
import { QueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

const mockStops = [
  { id: '101', name: 'Times Square', parent: null, routes: 'A,C,E,1,2,3', lat: 40.75, lon: -73.98 },
  { id: '101N', name: 'Times Square', parent: '101', routes: 'A,C,E', lat: 40.75, lon: -73.98 },
  { id: '102', name: 'Penn Station', parent: null, routes: '1,2,3', lat: 40.75, lon: -73.99 },
  { id: '103', name: 'Grand Central', parent: null, routes: '4,5,6', lat: 40.75, lon: -73.97 },
];

const mockRoutes = [
  { route_id: 'A', route_name: 'A Train', color: '#0039A6' },
  { route_id: '1', route_name: '1 Train', color: '#EE352E' },
];

const mockEnriched = {
  '101': { enrichedName: 'Times Square-42 St', crossStreet: '42nd St & 7th Ave' },
  '102': { enrichedName: 'Penn Station-34 St', crossStreet: '34th St & 7th Ave' },
};

describe('useStaticData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/stops') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStops),
        });
      }
      if (url === '/api/v1/routes') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRoutes),
        });
      }
      if (url === '/data/stations-enriched.json') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockEnriched),
        });
      }
      return Promise.resolve({ ok: false });
    });
  });

  it('returns loading state initially', () => {
    const { result } = renderHook(() => useStaticData(), { wrapper: QueryWrapper });

    expect(result.current.isLoading).toBe(true);
  });

  it('returns stations after loading', async () => {
    const { result } = renderHook(() => useStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(Object.keys(result.current.stations)).toHaveLength(4);
    expect(result.current.stations['101']).toBeDefined();
  });

  it('returns routes after loading', async () => {
    const { result } = renderHook(() => useStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(Object.keys(result.current.routes)).toHaveLength(2);
    expect(result.current.routes['A']).toBeDefined();
  });

  it('identifies parent stations correctly', async () => {
    const { result } = renderHook(() => useStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Parent stations have numeric-only IDs and no parent
    expect(result.current.parentStations).toContain('101');
    expect(result.current.parentStations).toContain('102');
    expect(result.current.parentStations).toContain('103');
    expect(result.current.parentStations).not.toContain('101N'); // Has parent
  });

  it('merges enriched data with stops', async () => {
    const { result } = renderHook(() => useStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stations['101'].enrichedName).toBe('Times Square-42 St');
    expect(result.current.stations['101'].crossStreet).toBe('42nd St & 7th Ave');
  });

  it('handles fetch error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });
});

describe('useStationsByRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
      return Promise.resolve({ ok: false });
    });
  });

  it('filters stations by route', async () => {
    const { result } = renderHook(() => useStationsByRoute('A'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    // Should include Times Square (has A route) but not Penn Station or Grand Central
    expect(result.current.some((s) => s.id === '101')).toBe(true);
    expect(result.current.some((s) => s.id === '101N')).toBe(true);
    expect(result.current.some((s) => s.id === '102')).toBe(false); // 1,2,3 only
    expect(result.current.some((s) => s.id === '103')).toBe(false); // 4,5,6 only
  });

  it('is case-insensitive', async () => {
    const { result } = renderHook(() => useStationsByRoute('a'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    expect(result.current.some((s) => s.id === '101')).toBe(true);
  });

  it('returns empty array for unknown route', async () => {
    const { result } = renderHook(() => useStationsByRoute('Z'), { wrapper: QueryWrapper });

    await waitFor(() => {
      // Wait for data to load
      expect(result.current).toEqual([]);
    });
  });
});

describe('useSearchStations', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
      return Promise.resolve({ ok: false });
    });
  });

  it('returns empty array for empty query', async () => {
    const { result } = renderHook(() => useSearchStations(''), { wrapper: QueryWrapper });

    expect(result.current).toEqual([]);
  });

  it('searches by station name', async () => {
    const { result } = renderHook(() => useSearchStations('Times'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    expect(result.current.some((s) => s.name.includes('Times'))).toBe(true);
  });

  it('searches by enriched name', async () => {
    const { result } = renderHook(() => useSearchStations('42 St'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    // Should find Times Square via enrichedName "Times Square-42 St"
    expect(result.current.some((s) => s.id === '101')).toBe(true);
  });

  it('is case-insensitive', async () => {
    const { result } = renderHook(() => useSearchStations('TIMES'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });
  });

  it('only searches parent stations', async () => {
    const { result } = renderHook(() => useSearchStations('Times'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    // Should return parent (101) but not child (101N)
    expect(result.current.some((s) => s.id === '101')).toBe(true);
    expect(result.current.some((s) => s.id === '101N')).toBe(false);
  });

  it('limits results to 20', async () => {
    // Create many mock stations
    const manyStops = Array.from({ length: 30 }, (_, i) => ({
      id: String(100 + i),
      name: `Test Station ${i}`,
      parent: null,
      routes: 'A',
      lat: 40.75,
      lon: -73.98,
    }));

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/stops') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(manyStops) });
      }
      if (url === '/api/v1/routes') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRoutes) });
      }
      if (url === '/data/stations-enriched.json') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false });
    });

    const { result } = renderHook(() => useSearchStations('Test'), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.length).toBeLessThanOrEqual(20);
    });
  });
});
