import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createMockTrainPosition } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';

// ---------------------------------------------------------------------------
// Mock socket provider — now only provides isAvailable
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

vi.mock('@/components/providers/SocketProvider', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    isAvailable: true,
  }),
}));

// Mock connectNamespaceSocket to return our mock socket
vi.mock('@/lib/socket/client', () => ({
  connectNamespaceSocket: () => (mockSocketConnected ? mockSocket : null),
}));

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------
const mockUpdateTrains = vi.fn();
const mockRemoveTrains = vi.fn();

vi.mock('@/stores', () => ({
  useTrainsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      updateTrains: mockUpdateTrains,
      removeTrains: mockRemoveTrains,
      trains: {},
    })
  ),
}));

// ---------------------------------------------------------------------------
// Mock fetch for polling fallback
// ---------------------------------------------------------------------------
const mockTrains = [
  createMockTrainPosition({ tripId: 'poll-trip-1', routeId: '1' }),
  createMockTrainPosition({ tripId: 'poll-trip-2', routeId: 'A' }),
];

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () =>
    Promise.resolve({
      trains: mockTrains,
      updatedAt: new Date().toISOString(),
    }),
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { useTrainPositions } from '../use-train-positions';

describe('useTrainPositions - WebSocket mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketConnected = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to polling when socket is not connected', async () => {
    mockSocketConnected = false;
    vi.useRealTimers(); // need real timers for fetch

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/trains');
    });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(2);
    });
  });

  it('subscribes to trains:update when socket is connected', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
    });
  });

  it('registers trains:update and trains:remove listeners', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'trains:update',
        expect.any(Function)
      );
    });
    expect(mockSocketOn).toHaveBeenCalledWith(
      'trains:remove',
      expect.any(Function)
    );
  });

  it('stops polling once socket becomes active', async () => {
    mockSocketConnected = true;
    vi.useRealTimers(); // need real timers for fetch

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    // Wait for socket subscription to happen
    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
    });

    // Once socket is active, the hook returns socket-sourced data
    // with error = null (not a polling error response)
    expect(result.current.error).toBeNull();

    // Clear fetch call count -- any initial poll that happened is ok
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // Wait a bit to ensure no additional polling fetches fire
    await new Promise((r) => setTimeout(r, 100));

    // No additional fetches should have been made since socket is now active
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('processes incoming trains:update events into the store', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    // Wait for the on('trains:update', handler) to be registered
    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'trains:update',
        expect.any(Function)
      );
    });

    // Extract the handler that was registered
    const trainsUpdateCall = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'trains:update'
    );
    const handler = trainsUpdateCall![1];

    // Simulate a trains:update event from the server
    const incomingTrains = [
      createMockTrainPosition({ tripId: 'ws-trip-1', routeId: '6' }),
    ];

    act(() => {
      handler({
        feedGroupId: '1234567',
        trains: incomingTrains,
        updatedAt: new Date().toISOString(),
        stale: false,
      });
    });

    // The store update function should have been called
    expect(mockUpdateTrains).toHaveBeenCalledWith(incomingTrains);
  });

  it('processes incoming trains:remove events', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'trains:remove',
        expect.any(Function)
      );
    });

    // Extract the trains:remove handler
    const trainsRemoveCall = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'trains:remove'
    );
    const handler = trainsRemoveCall![1];

    // Simulate a trains:remove event
    act(() => {
      handler({ tripIds: ['ws-trip-1', 'ws-trip-2'] });
    });

    expect(mockRemoveTrains).toHaveBeenCalledWith(['ws-trip-1', 'ws-trip-2']);
  });

  it('cleans up socket listeners on unmount', async () => {
    mockSocketConnected = true;

    const { unmount } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalled();
    });

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      'trains:update',
      expect.any(Function)
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      'trains:remove',
      expect.any(Function)
    );
  });

  it('returns isLoading true initially when socket has no data', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    // Before any trains:update event, isLoading should be true
    // because socketTrains is empty and socketUpdatedAt is undefined
    expect(result.current.isLoading).toBe(true);
  });

  it('does not fetch when disabled', async () => {
    mockSocketConnected = false;
    vi.useRealTimers();

    renderHook(
      () => useTrainPositions({ enabled: false }),
      { wrapper: QueryWrapper }
    );

    // Wait a bit to ensure nothing fires
    await new Promise((r) => setTimeout(r, 50));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSocketEmit).not.toHaveBeenCalled();
  });

  it('refetch re-subscribes when in socket mode', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
    });

    // Clear to track the refetch call
    mockSocketEmit.mockClear();

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
  });

  // -------------------------------------------------------------------------
  // trains:update updates the returned trains array (not just the store)
  // -------------------------------------------------------------------------

  it('returns socket trains in the trains array after update event', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'trains:update',
        expect.any(Function)
      );
    });

    const handler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'trains:update'
    )![1];

    const incomingTrains = [
      createMockTrainPosition({ tripId: 'ws-trip-A', routeId: 'A' }),
      createMockTrainPosition({ tripId: 'ws-trip-B', routeId: 'B' }),
    ];

    act(() => {
      handler({
        feedGroupId: 'ACE',
        trains: incomingTrains,
        updatedAt: '2026-02-24T12:00:00Z',
        stale: false,
      });
    });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(2);
      expect(result.current.trains.map((t) => t.tripId)).toContain('ws-trip-A');
      expect(result.current.trains.map((t) => t.tripId)).toContain('ws-trip-B');
      expect(result.current.updatedAt).toBe('2026-02-24T12:00:00Z');
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('merges subsequent trains:update events by tripId', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'trains:update',
        expect.any(Function)
      );
    });

    const handler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'trains:update'
    )![1];

    // First batch
    act(() => {
      handler({
        feedGroupId: 'ACE',
        trains: [
          createMockTrainPosition({ tripId: 'trip-1', routeId: 'A', lat: 40.0 }),
        ],
        updatedAt: '2026-02-24T12:00:00Z',
        stale: false,
      });
    });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(1);
    });

    // Second batch with same tripId (updated position) + new trip
    act(() => {
      handler({
        feedGroupId: 'ACE',
        trains: [
          createMockTrainPosition({ tripId: 'trip-1', routeId: 'A', lat: 40.1 }),
          createMockTrainPosition({ tripId: 'trip-2', routeId: 'C' }),
        ],
        updatedAt: '2026-02-24T12:01:00Z',
        stale: false,
      });
    });

    await waitFor(() => {
      // Should be 2 total, not 3 (trip-1 was merged, not duplicated)
      expect(result.current.trains).toHaveLength(2);
      const trip1 = result.current.trains.find((t) => t.tripId === 'trip-1');
      expect(trip1?.lat).toBe(40.1);
    });
  });

  it('removes trains from returned array via trains:remove', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'trains:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'trains:update'
    )![1];
    const removeHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'trains:remove'
    )![1];

    // Add trains first
    act(() => {
      updateHandler({
        feedGroupId: 'ACE',
        trains: [
          createMockTrainPosition({ tripId: 'keep-me', routeId: 'A' }),
          createMockTrainPosition({ tripId: 'remove-me', routeId: 'C' }),
        ],
        updatedAt: new Date().toISOString(),
        stale: false,
      });
    });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(2);
    });

    // Now remove one
    act(() => {
      removeHandler({ tripIds: ['remove-me'] });
    });

    await waitFor(() => {
      expect(result.current.trains).toHaveLength(1);
      expect(result.current.trains[0].tripId).toBe('keep-me');
    });
  });

  // -------------------------------------------------------------------------
  // Disconnect / connect event simulation
  // -------------------------------------------------------------------------

  it('registers connect and disconnect listeners on the socket', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'connect',
        expect.any(Function)
      );
      expect(mockSocketOn).toHaveBeenCalledWith(
        'disconnect',
        expect.any(Function)
      );
    });
  });

  it('cleans up connect and disconnect listeners on unmount', async () => {
    mockSocketConnected = true;

    const { unmount } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'connect',
        expect.any(Function)
      );
    });

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      'connect',
      expect.any(Function)
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      'disconnect',
      expect.any(Function)
    );
  });

  it('returns error null when socket is active', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useTrainPositions({ refreshInterval: 15000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
    });

    // In socket mode, error should always be null
    expect(result.current.error).toBeNull();
  });
});
