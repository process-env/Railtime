'use client';

import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  TrainsServerToClientEvents,
  TrainsClientToServerEvents,
  AlertsServerToClientEvents,
  AlertsClientToServerEvents,
  ArrivalsServerToClientEvents,
  ArrivalsClientToServerEvents,
} from '@/types/ws-events';

// ---------------------------------------------------------------------------
// Type helpers for namespace-specific sockets
// ---------------------------------------------------------------------------

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type TrainsSocket = Socket<
  TrainsServerToClientEvents,
  TrainsClientToServerEvents
>;
export type AlertsSocket = Socket<
  AlertsServerToClientEvents,
  AlertsClientToServerEvents
>;
export type ArrivalsSocket = Socket<
  ArrivalsServerToClientEvents,
  ArrivalsClientToServerEvents
>;

// ---------------------------------------------------------------------------
// Root namespace socket (kept for backward compatibility / SocketProvider)
// ---------------------------------------------------------------------------

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket | null {
  if (socket) return socket;

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) return null;

  socket = io(wsUrl, {
    transports: ['websocket', 'polling'],
    parser: msgpackParser,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 10000,
    autoConnect: false,
  });

  return socket;
}

export function connectSocket(): TypedSocket | null {
  const s = getSocket();
  if (s && !s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

// ---------------------------------------------------------------------------
// Per-namespace sockets
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const namespaceSockets = new Map<string, Socket<any, any>>();

const SOCKET_OPTIONS = {
  transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser: msgpackParser as any,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  timeout: 10000,
  autoConnect: false,
};

/**
 * Returns (or creates) a Socket.IO connection for the given namespace.
 *
 * The namespace string should include the leading slash, e.g. "/trains".
 * The returned socket is NOT auto-connected; call `.connect()` or use
 * `connectNamespaceSocket()`.
 */
export function getNamespaceSocket<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S extends Socket<any, any> = TypedSocket,
>(namespace: string): S | null {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) return null;

  const existing = namespaceSockets.get(namespace);
  if (existing) return existing as S;

  const s = io(`${wsUrl}${namespace}`, SOCKET_OPTIONS);
  namespaceSockets.set(namespace, s);
  return s as S;
}

/**
 * Get-or-create a namespace socket and connect it if not already connected.
 */
export function connectNamespaceSocket<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S extends Socket<any, any> = TypedSocket,
>(namespace: string): S | null {
  const s = getNamespaceSocket<S>(namespace);
  if (s && !s.connected) s.connect();
  return s;
}

/**
 * Disconnect and clear ALL sockets: root + every namespace.
 */
export function disconnectAll(): void {
  disconnectSocket();
  for (const [, s] of namespaceSockets) {
    s.disconnect();
  }
  namespaceSockets.clear();
}
