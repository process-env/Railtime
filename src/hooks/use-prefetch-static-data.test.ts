import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePrefetchStaticData } from './use-prefetch-static-data';
import { QueryWrapper, createTestQueryClient, createQueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

describe('usePrefetchStaticData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/stops') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: '101', name: 'Times Square' }]),
        });
      }
      if (url === '/api/v1/routes') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ route_id: 'A', route_name: 'A Train' }]),
        });
      }
      if (url === '/data/stations-enriched.json') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ '101': { enrichedName: 'Times Square-42 St' } }),
        });
      }
      return Promise.resolve({ ok: false });
    });
  });

  it('prefetches stops data', async () => {
    renderHook(() => usePrefetchStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/stops');
    });
  });

  it('prefetches routes data', async () => {
    renderHook(() => usePrefetchStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/routes');
    });
  });

  it('prefetches enriched stations data', async () => {
    renderHook(() => usePrefetchStaticData(), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/data/stations-enriched.json');
    });
  });

  it('calls prefetchQuery for each data type', async () => {
    const queryClient = createTestQueryClient();
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');

    renderHook(() => usePrefetchStaticData(), {
      wrapper: createQueryWrapper(queryClient),
    });

    // Verify prefetchQuery was called for each data type
    await waitFor(() => {
      expect(prefetchSpy).toHaveBeenCalledTimes(3);
    });

    // Verify the query keys used
    const calls = prefetchSpy.mock.calls;
    const queryKeys = calls.map((call) => call[0].queryKey);
    expect(queryKeys).toContainEqual(['stops']);
    expect(queryKeys).toContainEqual(['routes']);
    expect(queryKeys).toContainEqual(['enriched-stations']);
  });

  it('does not prefetch historical data (disabled for performance)', async () => {
    renderHook(() => usePrefetchStaticData(), { wrapper: QueryWrapper });

    // Wait for other fetches to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/stops');
    });

    // Historical endpoint should NOT be called
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/analytics/historical')
    );
  });

  it('only runs prefetch once on mount', async () => {
    const queryClient = createTestQueryClient();

    const { rerender } = renderHook(() => usePrefetchStaticData(), {
      wrapper: createQueryWrapper(queryClient),
    });

    // Wait for initial prefetch
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Clear mock to track new calls
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // Rerender should not trigger additional fetches (effect only runs once)
    rerender();

    // Give time for any potential fetches
    await new Promise((r) => setTimeout(r, 50));

    // No new fetch calls (useEffect only runs once with [queryClient] dependency)
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
