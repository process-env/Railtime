import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAlerts } from './use-alerts';
import { useAlertsStore } from '@/stores';
import { createMockServiceAlert } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

describe('useAlerts', () => {
  const mockAlerts = [
    createMockServiceAlert({ id: 'alert1', severity: 'critical' }),
    createMockServiceAlert({ id: 'alert2', severity: 'warning' }),
  ];

  beforeEach(() => {
    // Reset store state (for dismissedIds)
    useAlertsStore.setState({
      dismissedIds: new Set(),
    });

    vi.clearAllMocks();

    // Default mock for fetch
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ alerts: mockAlerts }),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('fetches alerts on mount', async () => {
    renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/alerts');
    });
  });

  it('does not fetch when disabled', async () => {
    renderHook(() => useAlerts({ enabled: false, refreshInterval: 0 }), { wrapper: QueryWrapper });

    // Give some time for potential fetch
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns fetched alerts', async () => {
    const { result } = renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(2);
    });
  });

  it('adds route filter to URL when routeIds provided', async () => {
    renderHook(() => useAlerts({ routeIds: ['A', 'C'], refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/alerts?route=A,C');
    });
  });

  it('sets error on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });

  it('sets error on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      statusText: 'Server Error',
    });

    const { result } = renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.error).toContain('Failed to fetch alerts');
    });
  });

  it('returns alert counts', async () => {
    const { result } = renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(result.current.counts).toEqual({
        critical: 1,
        warning: 1,
        info: 0,
      });
    });
  });

  it('provides refetch function', async () => {
    const { result } = renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles unmount without errors', async () => {
    const { unmount } = renderHook(() => useAlerts({ refreshInterval: 0 }), { wrapper: QueryWrapper });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Unmount should not throw
    expect(() => unmount()).not.toThrow();
  });
});
