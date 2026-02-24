import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createMockServiceAlert } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';

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
// Reset alerts store state before each test (use real Zustand store)
// ---------------------------------------------------------------------------
import { useAlertsStore } from '@/stores';

// ---------------------------------------------------------------------------
// Mock fetch for polling fallback
// ---------------------------------------------------------------------------
const mockAlerts = [
  createMockServiceAlert({ id: 'poll-alert-1', severity: 'critical' }),
  createMockServiceAlert({ id: 'poll-alert-2', severity: 'warning' }),
];

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ alerts: mockAlerts }),
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { useAlerts } from '../use-alerts';

describe('useAlerts - WebSocket mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketConnected = false;
    mockIsAvailable = true;
    // Reset the real Zustand store
    useAlertsStore.setState({ dismissedIds: new Set() });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Connection and subscription
  // -------------------------------------------------------------------------

  it('subscribes to alerts via subscribe:all when socket is connected', async () => {
    mockSocketConnected = true;

    renderHook(() => useAlerts({ refreshInterval: 60000 }), {
      wrapper: QueryWrapper,
    });

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
    });
  });

  it('registers alerts:update, alerts:new, and alerts:cleared listeners', async () => {
    mockSocketConnected = true;

    renderHook(() => useAlerts({ refreshInterval: 60000 }), {
      wrapper: QueryWrapper,
    });

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });
    expect(mockSocketOn).toHaveBeenCalledWith(
      'alerts:new',
      expect.any(Function)
    );
    expect(mockSocketOn).toHaveBeenCalledWith(
      'alerts:cleared',
      expect.any(Function)
    );
  });

  // -------------------------------------------------------------------------
  // Event handling — alerts:update
  // -------------------------------------------------------------------------

  it('processes alerts:update events into returned alerts', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    // Wait for the listener to be registered
    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    // Extract the handler
    const updateCall = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    );
    const handler = updateCall![1];

    const wsAlerts = [
      createMockServiceAlert({
        id: 'ws-alert-1',
        severity: 'critical',
        headerText: 'Delays on A line',
      }),
    ];

    act(() => {
      handler({
        alerts: wsAlerts,
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].id).toBe('ws-alert-1');
    });
  });

  // -------------------------------------------------------------------------
  // Event handling — alerts:new
  // -------------------------------------------------------------------------

  it('adds new alerts from alerts:new events', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    // First deliver a bulk update so socketActive becomes true
    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];
    const newHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:new'
    )![1];

    const initialAlert = createMockServiceAlert({ id: 'existing-1' });

    act(() => {
      updateHandler({
        alerts: [initialAlert],
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(1);
    });

    // Now add a new alert
    const newAlert = createMockServiceAlert({
      id: 'new-alert-1',
      severity: 'critical',
    });

    act(() => {
      newHandler({ alert: newAlert });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(2);
      expect(result.current.alerts.map((a) => a.id)).toContain('new-alert-1');
    });
  });

  it('does not duplicate alerts from alerts:new if id already exists', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];
    const newHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:new'
    )![1];

    const alert = createMockServiceAlert({ id: 'dup-alert' });

    act(() => {
      updateHandler({
        alerts: [alert],
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(1);
    });

    // Push the same id again via alerts:new
    act(() => {
      newHandler({ alert });
    });

    // Should still be 1
    expect(result.current.alerts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Event handling — alerts:cleared
  // -------------------------------------------------------------------------

  it('removes alerts from alerts:cleared events', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];
    const clearedHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:cleared'
    )![1];

    const alerts = [
      createMockServiceAlert({ id: 'keep-me' }),
      createMockServiceAlert({ id: 'remove-me' }),
    ];

    act(() => {
      updateHandler({
        alerts,
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(2);
    });

    act(() => {
      clearedHandler({ alertId: 'remove-me' });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].id).toBe('keep-me');
    });
  });

  // -------------------------------------------------------------------------
  // Route filtering on socket data
  // -------------------------------------------------------------------------

  it('filters socket alerts by routeIds when specified', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000, routeIds: ['A'] }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];

    const alerts = [
      createMockServiceAlert({
        id: 'a-alert',
        affectedRoutes: ['A', 'C'],
      }),
      createMockServiceAlert({
        id: 'l-alert',
        affectedRoutes: ['L'],
      }),
    ];

    act(() => {
      updateHandler({
        alerts,
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      // Only the alert affecting route A should be returned
      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].id).toBe('a-alert');
    });
  });

  it('filters alerts:new events by routeIds', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000, routeIds: ['G'] }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];
    const newHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:new'
    )![1];

    // Deliver initial empty set
    act(() => {
      updateHandler({
        alerts: [],
        updatedAt: new Date().toISOString(),
      });
    });

    // Push a new alert that does NOT match route filter
    const nonMatchingAlert = createMockServiceAlert({
      id: 'no-match',
      affectedRoutes: ['L'],
    });

    act(() => {
      newHandler({ alert: nonMatchingAlert });
    });

    // Should be empty since L is not in routeIds
    expect(result.current.alerts).toHaveLength(0);

    // Push a new alert that matches route filter
    const matchingAlert = createMockServiceAlert({
      id: 'match',
      affectedRoutes: ['G'],
    });

    act(() => {
      newHandler({ alert: matchingAlert });
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].id).toBe('match');
    });
  });

  // -------------------------------------------------------------------------
  // Polling fallback
  // -------------------------------------------------------------------------

  it('falls back to polling when socket is not available', async () => {
    mockSocketConnected = false;
    mockIsAvailable = false;
    vi.useRealTimers();

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/alerts');
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(2);
    });
  });

  it('falls back to polling when socket is not connected', async () => {
    mockSocketConnected = false;
    vi.useRealTimers();

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 0 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/alerts');
    });

    await waitFor(() => {
      expect(result.current.alerts).toHaveLength(2);
    });
  });

  it('stops polling once socket delivers first data', async () => {
    mockSocketConnected = true;
    vi.useRealTimers();

    renderHook(() => useAlerts({ refreshInterval: 60000 }), {
      wrapper: QueryWrapper,
    });

    // Wait for socket subscription
    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('subscribe:all');
    });

    // Deliver first data so socketActive becomes true
    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];

    act(() => {
      updateHandler({
        alerts: [createMockServiceAlert({ id: 'ws-1' })],
        updatedAt: new Date().toISOString(),
      });
    });

    // Clear fetch count
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // Wait a bit — no polling should happen
    await new Promise((r) => setTimeout(r, 100));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Return shape when socket is active
  // -------------------------------------------------------------------------

  it('returns isLoading false and error null when socket is active', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];

    act(() => {
      updateHandler({
        alerts: [createMockServiceAlert({ id: 'ws-1' })],
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  it('computes severity counts from socket alerts', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];

    act(() => {
      updateHandler({
        alerts: [
          createMockServiceAlert({ id: 'c1', severity: 'critical' }),
          createMockServiceAlert({ id: 'c2', severity: 'critical' }),
          createMockServiceAlert({ id: 'w1', severity: 'warning' }),
          createMockServiceAlert({ id: 'i1', severity: 'info' }),
        ],
        updatedAt: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(result.current.counts).toEqual({
        critical: 2,
        warning: 1,
        info: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  it('cleans up socket listeners on unmount', async () => {
    mockSocketConnected = true;

    const { unmount } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalled();
    });

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      'alerts:update',
      expect.any(Function)
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      'alerts:new',
      expect.any(Function)
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      'alerts:cleared',
      expect.any(Function)
    );
  });

  it('does not subscribe when disabled', async () => {
    mockSocketConnected = true;

    renderHook(
      () => useAlerts({ enabled: false, refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    // Wait a bit to ensure nothing fires
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSocketEmit).not.toHaveBeenCalled();
  });

  it('ignores alerts:new with null or missing alert data', async () => {
    mockSocketConnected = true;

    const { result } = renderHook(
      () => useAlerts({ refreshInterval: 60000 }),
      { wrapper: QueryWrapper }
    );

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        'alerts:update',
        expect.any(Function)
      );
    });

    const updateHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:update'
    )![1];
    const newHandler = mockSocketOn.mock.calls.find(
      (call) => call[0] === 'alerts:new'
    )![1];

    act(() => {
      updateHandler({
        alerts: [],
        updatedAt: new Date().toISOString(),
      });
    });

    // Send malformed data
    act(() => {
      newHandler({ alert: null });
    });

    act(() => {
      newHandler({ alert: {} });
    });

    // Should not crash and should still be empty
    expect(result.current.alerts).toHaveLength(0);
  });
});
