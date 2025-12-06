import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTrainPositions } from './use-train-positions';
import { createMockTrainPosition } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

describe('useTrainPositions', () => {
  const mockTrains = [
    createMockTrainPosition({ tripId: 'trip1', routeId: '1' }),
    createMockTrainPosition({ tripId: 'trip2', routeId: 'A' }),
    createMockTrainPosition({ tripId: 'trip3', routeId: 'B' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for fetch
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ trains: mockTrains, updatedAt: new Date().toISOString() }),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('fetches trains on mount', async () => {
    renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/trains');
    });
  });

  it('does not fetch when disabled', async () => {
    renderHook(() => useTrainPositions({ enabled: false }), { wrapper: QueryWrapper });

    // Give some time for potential fetch
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns trains array', async () => {
    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(3);
    });
  });

  it('includes route and trip IDs', async () => {
    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.trains.length).toBeGreaterThan(0);
    });

    const train = result.current.trains[0];
    expect(train).toHaveProperty('tripId');
    expect(train).toHaveProperty('routeId');
    expect(train).toHaveProperty('lat');
    expect(train).toHaveProperty('lon');
  });

  it('handles fetch errors', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });

  it('handles non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });

    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.error).toContain('Failed to fetch trains');
    });
  });

  it('provides refetch function', async () => {
    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns updatedAt timestamp', async () => {
    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.updatedAt).toBeDefined();
    });
  });

  it('starts with isLoading true', () => {
    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isLoading to false after fetch', async () => {
    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('handles empty response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ trains: [], updatedAt: new Date().toISOString() }),
    });

    const { result } = renderHook(() => useTrainPositions({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(0);
      expect(result.current.isLoading).toBe(false);
    });
  });
});
