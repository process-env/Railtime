import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAnalytics } from './use-analytics';
import { createMockTrainPosition } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';
import { FEED_GROUPS } from '@/lib/constants';

// Mock fetch
global.fetch = vi.fn();

describe('useAnalytics', () => {
  const mockTrains = [
    createMockTrainPosition({ tripId: 'trip1', routeId: 'A' }),
    createMockTrainPosition({ tripId: 'trip2', routeId: 'A' }),
    createMockTrainPosition({ tripId: 'trip3', routeId: 'B' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock all fetch calls
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      // Trains endpoint
      if (url === '/api/v1/trains') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ trains: mockTrains, updatedAt: new Date().toISOString() }),
        });
      }
      // Feed status endpoints
      if (url.startsWith('/api/v1/feed/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ tripId: 'test' }]),
        });
      }
      // Historical data endpoint
      if (url.startsWith('/api/v1/analytics/historical')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            trainHistory: [],
            delayDistribution: [],
            collectionStats: { totalSnapshots: 0 },
          }),
        });
      }
      // Default
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('starts with loading true', () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });
    expect(result.current.loading).toBe(true);
  });

  it('calculates route activity from trains', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    // Wait for trains data to load (stats.totalTrains > 0 means trains are loaded)
    await waitFor(() => {
      expect(result.current.data?.stats.totalTrains).toBeGreaterThan(0);
    });

    const routeA = result.current.data?.routeActivity.find((r) => r.routeId === 'A');
    const routeB = result.current.data?.routeActivity.find((r) => r.routeId === 'B');

    expect(routeA?.trainCount).toBe(2);
    expect(routeB?.trainCount).toBe(1);
  });

  it('generates timeline data', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.data?.timeline).toBeDefined();
    });

    expect(result.current.data?.timeline).toHaveLength(12);
    expect(result.current.data?.timeline[0]).toHaveProperty('time');
    expect(result.current.data?.timeline[0]).toHaveProperty('arrivals');
    expect(result.current.data?.timeline[0]).toHaveProperty('departures');
  });

  it('calculates stats', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    // Wait for trains data to actually load (not just stats object existing)
    await waitFor(() => {
      expect(result.current.data?.stats.totalTrains).toBeGreaterThan(0);
    });

    expect(result.current.data?.stats.totalTrains).toBe(3);
    expect(result.current.data?.stats.totalStations).toBe(472);
    expect(typeof result.current.data?.stats.avgDelay).toBe('number');
    expect(typeof result.current.data?.stats.feedHealth).toBe('number');
  });

  it('sets loading to false after fetch', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('handles fetch errors gracefully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/trains') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ trains: mockTrains, updatedAt: new Date().toISOString() }),
        });
      }
      // Feed endpoints fail
      if (url.startsWith('/api/v1/feed/')) {
        return Promise.resolve({ ok: false });
      }
      if (url.startsWith('/api/v1/analytics/historical')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            trainHistory: [],
            delayDistribution: [],
            collectionStats: { totalSnapshots: 0 },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    // The hook catches errors internally - it should still complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Data should still be defined (with error feeds)
    expect(result.current.data).toBeDefined();
  });

  it('provides refresh function', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(typeof result.current.refresh).toBe('function');
    });
  });

  it('marks feed as healthy on successful fetch', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    await waitFor(() => {
      const healthyFeeds = result.current.data?.feedStatus.filter(
        (f) => f.status === 'healthy'
      );
      expect(healthyFeeds?.length).toBeGreaterThan(0);
    });
  });

  it('marks feed as error on failed fetch', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/trains') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ trains: mockTrains, updatedAt: new Date().toISOString() }),
        });
      }
      // All feed endpoints return error
      if (url.startsWith('/api/v1/feed/')) {
        return Promise.resolve({ ok: false });
      }
      if (url.startsWith('/api/v1/analytics/historical')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            trainHistory: [],
            delayDistribution: [],
            collectionStats: { totalSnapshots: 0 },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    await waitFor(() => {
      const errorFeeds = result.current.data?.feedStatus.filter(
        (f) => f.status === 'error'
      );
      expect(errorFeeds?.length).toBeGreaterThan(0);
    });
  });

  it('includes all subway routes in activity', async () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.data?.routeActivity.length).toBeGreaterThan(0);
    });

    const routeIds = result.current.data?.routeActivity.map((r) => r.routeId);
    expect(routeIds).toContain('A');
    expect(routeIds).toContain('1');
  });
});
