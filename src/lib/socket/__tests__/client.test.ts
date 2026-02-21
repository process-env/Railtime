import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock socket.io-client before any imports that use it
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

let mockConnected = false;

const mockSocketInstance = {
  connect: mockConnect,
  disconnect: mockDisconnect,
  on: mockOn,
  off: mockOff,
  get connected() {
    return mockConnected;
  },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocketInstance),
}));

describe('Socket Client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockConnected = false;
    // Clear env var between tests
    delete process.env.NEXT_PUBLIC_WS_URL;
  });

  describe('getSocket', () => {
    it('returns null when NEXT_PUBLIC_WS_URL is not set', async () => {
      delete process.env.NEXT_PUBLIC_WS_URL;
      const { getSocket } = await import('../client');
      expect(getSocket()).toBeNull();
    });

    it('creates a socket when NEXT_PUBLIC_WS_URL is set', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      const { getSocket } = await import('../client');
      const socket = getSocket();
      expect(socket).not.toBeNull();
    });

    it('returns the same socket instance on subsequent calls (singleton)', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      const { getSocket } = await import('../client');
      const socket1 = getSocket();
      const socket2 = getSocket();
      expect(socket1).toBe(socket2);
    });

    it('creates socket with correct transport options', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      const { io } = await import('socket.io-client');
      const { getSocket } = await import('../client');
      getSocket();

      expect(io).toHaveBeenCalledWith('http://localhost:3001', expect.objectContaining({
        transports: ['websocket', 'polling'],
        reconnection: true,
        autoConnect: false,
      }));
    });
  });

  describe('connectSocket', () => {
    it('returns null when no WS URL is configured', async () => {
      delete process.env.NEXT_PUBLIC_WS_URL;
      const { connectSocket } = await import('../client');
      expect(connectSocket()).toBeNull();
    });

    it('calls connect() on the socket when not already connected', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      mockConnected = false;
      const { connectSocket } = await import('../client');
      connectSocket();
      expect(mockConnect).toHaveBeenCalled();
    });

    it('does not call connect() when already connected', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      mockConnected = true;
      const { connectSocket } = await import('../client');
      connectSocket();
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe('disconnectSocket', () => {
    it('calls disconnect() and nullifies the socket', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      const { getSocket, disconnectSocket } = await import('../client');

      // First create a socket
      getSocket();

      // Then disconnect
      disconnectSocket();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('does nothing when no socket exists', async () => {
      delete process.env.NEXT_PUBLIC_WS_URL;
      const { disconnectSocket } = await import('../client');
      // Should not throw
      disconnectSocket();
      expect(mockDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('isSocketConnected', () => {
    it('returns false when no socket exists', async () => {
      delete process.env.NEXT_PUBLIC_WS_URL;
      const { isSocketConnected } = await import('../client');
      expect(isSocketConnected()).toBe(false);
    });

    it('returns false when socket exists but is not connected', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      mockConnected = false;
      const { getSocket, isSocketConnected } = await import('../client');
      getSocket();
      expect(isSocketConnected()).toBe(false);
    });

    it('returns true when socket is connected', async () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://localhost:3001';
      mockConnected = true;
      const { getSocket, isSocketConnected } = await import('../client');
      getSocket();
      expect(isSocketConnected()).toBe(true);
    });
  });
});
