import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createMockArrival } from '@/test/factories';
import { QueryWrapper, createQueryWrapper, createTestQueryClient } from '@/test/utils/query-wrapper';

// ---------------------------------------------------------------------------
// Mock socket — mimics a Socket.IO namespace socket
// ---------------------------------------------------------------------------
let mockSocketConnected = false;
const mockSocketOn = vi.fn();
const mockSocketOff = vi.fn();
const mockSocketEmit = vi.fn();

const mockSocket = {
  get connected() {
    return mockSocketConnected;
  },
  on: mockSocketOn,
  off: mockSocketOff,
  emit: mockSocketEmit,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock SocketProvider — only provides isAvailable flag
// ---------------------------------------------------------------------------
let mockIsAvailable = true;

vi.mock('@/components/providers/SocketProvider', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    isAvailable: mockIsAvailable,
  }),
}));

// Mock connectNamespaceSocket to return our mock socket
vi.mock('@/lib/socket/client', () => ({
  connectNamespaceSocket: vi.fn(() =>
    mockSocketConnected ? mockSocket : null
  ),
}));

// ---------------------------------------------------------------------------
// Mock fetch for polling fallback
// ---------------------------------------------------------------------------
const mockArrivalBoard = {
  stopId: '101N',
  stopName: 'Test Station',
  updatedAt: '2024-01-15T12:00:00Z',
  now: new Date().toISOString(),
  arrivals: [
    createMockArrival({ tripId: 'poll-trip-1', routeId: 'A' }),
    createMockArrival({ tripId: 'poll-trip-2', routeId: 'C' }),
  ],
};

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(mockArrivalBoard),
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { useArrivals } from '../use-arrivals';

describe('useArrivals - WebSocket mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketConnected = false;
    mockIsAvailable = true;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Connection and per-station subscription
  // -------------------------------------------------------------------------

  it('subscribes to station via subscribe:station when socket is connected', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'subscribe:station',
        '101N'
      );
    });
  });

  it('registers arrivals:update listener', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'arrivals:update',
        expect.any(Function)
      );
    });
  });

  // -------------------------------------------------------------------------
  // Event handling — arrivals:update
  // -------------------------------------------------------------------------

  it('processes arrivals:update events for the subscribed station', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'arrivals:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'arrivals:update'
    )![1];

    const wsArrivals = [
      createMockArrival({ tripId: 'ws-trip-1', routeId: 'A' }),
      createMockArrival({ tripId: 'ws-trip-2', routeId: 'C' }),
      createMockArrival({ tripId: 'ws-trip-3', routeId: 'E' }),
    ];

    act(() => {
      updateHandler({
        stationId: '101N',
        arrivals: wsArrivals,
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.arrivals).toBeDefined();
      expect(result.current.arrivals!.arrivals).toHaveLength(3);
      expect(result.current.arrivals!.stopId).toBe('101N');
    });
  });

  it('ignores arrivals:update events for a different station', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'arrivals:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'arrivals:update'
    )![1];

    // Send update for a different station
    act(() => {
      updateHandler({
        stationId: '999S',
        arrivals: [createMockArrival({ tripId: 'other-trip' })],
        updatedAt: new Date().toISOString(),
      });
    });

    // Arrivals should remain null/undefined since no matching update
    expect(result.current.arrivals).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Station change — unsubscribe old, subscribe new
  // -------------------------------------------------------------------------

  it('unsubscribes from old station and subscribes to new one on stopId change', async () => {
    mockSocketConnected = true;
    const queryClient = createTestQueryClient();
    const wrapper = createQueryWrapper(queryClient);

    const { rerender } = renderHook(
      ({ stopId }) =>
        useArrivals('ACE', stopId, { refreshInterval: 30000 }),
      { wrapper, initialProps: { stopId: '101N' } }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'subscribe:station',
        '101N'
      );
    });

    mockSocketEmit.mockClear();

    rerender({ stopId: '102S' });

    await waitFor(() => {
      // Should unsubscribe from old station
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'unsubscribe:station',
        '101N'
      );
      // Should subscribe to new station
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'subscribe:station',
        '102S'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Unsubscribe on unmount
  // -------------------------------------------------------------------------

  it('unsubscribes from station on unmount', async () => {
    mockSocketConnected = true;

    const { unmount } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'subscribe:station',
        '101N'
      );
    });

    mockSocketEmit.mockClear();

    unmount();

    expect(mockSocketEmit).toHaveBeenCalledWith(
      'unsubscribe:station',
      '101N'
    );
  });

  it('cleans up socket listeners on unmount', async () => {
    mockSocketConnected = true;

    const { unmount } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalled();
    });

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      'arrivals:update',
      expect.any(Function)
    );
  });

  // -------------------------------------------------------------------------
  // Polling fallback
  // -------------------------------------------------------------------------

  it('falls back to polling when socket is not available', async () => {
    mockSocketConnected = false;
    mockIsAvailable = false;
    vi.useRealTimers();

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/arrivals/ACE/101N');
    });

    await waitFor(() => {
      expect(result.current.arrivals).toBeDefined();
      expect(result.current.arrivals!.arrivals).toHaveLength(2);
    });
  });

  it('falls back to polling when socket is not connected', async () => {
    mockSocketConnected = false;
    vi.useRealTimers();

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/arrivals/ACE/101N');
    });

    await waitFor(() => {
      expect(result.current.arrivals).toBeDefined();
    });
  });

  it('stops polling once socket becomes active', async () => {
    mockSocketConnected = true;
    vi.useRealTimers();

    renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    // Wait for socket subscription
    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'subscribe:station',
        '101N'
      );
    });

    // Clear fetch count
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // Wait a bit — no polling should happen while socket is active
    await new Promise((r) => setTimeout(r, 100));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Return shape when socket is active
  // -------------------------------------------------------------------------

  it('returns isLoading true when socket has no data yet', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    // Before any arrivals:update event, isLoading should be true
    // because socketArrivals is null
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });
  });

  it('returns isLoading false after socket delivers data', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'arrivals:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'arrivals:update'
    )![1];

    act(() => {
      updateHandler({
        stationId: '101N',
        arrivals: [createMockArrival({ tripId: 'ws-1' })],
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Refetch in socket mode
  // -------------------------------------------------------------------------

  it('refetch re-subscribes to station when in socket mode', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useArrivals('ACE', '101N', { refreshInterval: 30000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'subscribe:station',
        '101N'
      );
    });

    // Clear to track the refetch call
    mockSocketEmit.mockClear();

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockSocketEmit).toHaveBeenCalledWith(
      'subscribe:station',
      '101N'
    );
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  it('does not subscribe when disabled', async () => {
    mockSocketConnected = true;

    renderHook(
      () =>
        useArrivals('ACE', '101N', {
          enabled: false,
          refreshInterval: 30000,
        }),
      { wrapper: QueryWrapper }
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSocketEmit).not.toHaveBeenCalled();
  });
});
