import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useArrivals } from './use-arrivals';
import { createMockArrival } from '@/test/factories';
import { QueryWrapper, createQueryWrapper, createTestQueryClient } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

describe('useArrivals', () => {
  const mockArrivalBoard = {
    stopId: '101N',
    stopName: 'Test Station',
    updatedAt: '2024-01-15T12:00:00Z',
    now: new Date().toISOString(),
    arrivals: [
      createMockArrival({ tripId: 'trip1', routeId: 'A' }),
      createMockArrival({ tripId: 'trip2', routeId: 'C' }),
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockArrivalBoard),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('fetches arrivals with correct URL', async () => {
    renderHook(() => useArrivals('ACE', '101N', { refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/arrivals/ACE/101N');
    });
  });

  it('does not fetch when disabled', async () => {
    renderHook(
      () => useArrivals('ACE', '101N', { enabled: false, refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when groupId is empty', async () => {
    renderHook(() => useArrivals('', '101N', { refreshInterval: 0 }), { wrapper: QueryWrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when stopId is empty', async () => {
    renderHook(() => useArrivals('ACE', '', { refreshInterval: 0 }), { wrapper: QueryWrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns arrivals data', async () => {
    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(result.current.arrivals).toBeDefined();
      expect(result.current.arrivals?.arrivals).toHaveLength(2);
    });
  });

  it('sets error on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to fetch arrivals');
    });
  });

  it('sets error on network failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });

  it('provides refetch function', async () => {
    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns arrivals from query', async () => {
    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(result.current.arrivals).toBeDefined();
      expect(result.current.arrivals?.arrivals).toHaveLength(2);
    });
  });

  it('returns undefined when no arrivals fetched', () => {
    const { result } = renderHook(
      () => useArrivals('ACE', '999N', { enabled: false, refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );
    expect(result.current.arrivals).toBeUndefined();
  });

  it('refetches when stopId changes', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    const { rerender } = renderHook(
      ({ stopId }) => useArrivals('ACE', stopId, { refreshInterval: 0 }),
      { wrapper, initialProps: { stopId: '101N' } }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/arrivals/ACE/101N');
    });

    rerender({ stopId: '102S' });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/arrivals/ACE/102S');
    });
  });
});
