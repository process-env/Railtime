'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types/ws-events';
import { connectSocket, disconnectSocket } from '@/lib/socket/client';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketContextValue {
  socket: TypedSocket | null;
  isConnected: boolean;
  isAvailable: boolean; // true if NEXT_PUBLIC_WS_URL is set
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  isAvailable: false,
});

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<TypedSocket | null>(null);

  const isAvailable = typeof process !== 'undefined' && !!process.env.NEXT_PUBLIC_WS_URL;

  useEffect(() => {
    if (!isAvailable) return;

    const s = connectSocket();
    if (!s) return;

    setSocket(s);

    function onConnect() {
      console.log('[socket] Connected to WS server');
      setIsConnected(true);
    }

    function onDisconnect(reason: string) {
      console.log(`[socket] Disconnected: ${reason}`);
      setIsConnected(false);
    }

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    if (s.connected) {
      setIsConnected(true);
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      disconnectSocket();
      setIsConnected(false);
      setSocket(null);
    };
  }, [isAvailable]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, isAvailable }}>
      {children}
    </SocketContext.Provider>
  );
}
