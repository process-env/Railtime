'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import { useSocket } from '@/components/providers/SocketProvider';
import { connectNamespaceSocket, type ArrivalsSocket } from '@/lib/socket/client';
import type { ArrivalBoard } from '@/types/mta';

interface UseArrivalsOptions {
  refreshInterval?: number;
  enabled?: boolean;
}

/** Threshold in ms before falling back to polling after socket disconnect */
const FALLBACK_DELAY_MS = 30_000;

export function useArrivals(
  groupId: string,
  stopId: string,
  options: UseArrivalsOptions = {}
) {
  const { refreshInterval = 30000, enabled = true } = options;

  // We only use the root socket context to check if WS is available at all
  const { isAvailable } = useSocket();

  // Per-namespace socket state for /arrivals
  const [socket, setSocket] = useState<ArrivalsSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const queryClient = useQueryClient();

  const [socketActive, setSocketActive] = useState(false);
  const disconnectedAtRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStopIdRef = useRef<string | null>(null);

  // Socket-pushed arrival data
  const [socketArrivals, setSocketArrivals] = useState<ArrivalBoard | null>(
    null
  );

  // --- Connect to /arrivals namespace ---
  useEffect(() => {
    if (!isAvailable || !enabled) return;

    const s = connectNamespaceSocket<ArrivalsSocket>('/arrivals');
    if (!s) return;

    function onConnect() {
      setIsConnected(true);
      setSocket(s);
    }
    function onDisconnect() {
      setIsConnected(false);
    }

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    if (s.connected) {
      onConnect();
    } else {
      queueMicrotask(() => setSocket(s));
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, [isAvailable, enabled]);

  // --- Socket lifecycle (subscribe / fallback) ---
  useEffect(() => {
    if (!socket || !enabled || !stopId) return;

    if (isConnected) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      disconnectedAtRef.current = null;

      // Unsubscribe from previous station if stopId changed
      if (prevStopIdRef.current && prevStopIdRef.current !== stopId) {
        socket.emit('unsubscribe:station', prevStopIdRef.current);
      }

      // Subscribe to this station
      socket.emit('subscribe:station', stopId);
      prevStopIdRef.current = stopId;
      queueMicrotask(() => setSocketActive(true));
    } else {
      if (disconnectedAtRef.current === null) {
        disconnectedAtRef.current = Date.now();
      }

      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
      fallbackTimerRef.current = setTimeout(() => {
        setSocketActive(false);
        queryClient.invalidateQueries({
          queryKey: queryKeys.arrivals(groupId, stopId),
        });
      }, FALLBACK_DELAY_MS);
    }

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [socket, isConnected, enabled, stopId, groupId, queryClient]);

  // Cleanup: unsubscribe when component unmounts or stopId changes
  useEffect(() => {
    const capturedStopId = prevStopIdRef.current;
    return () => {
      if (socket?.connected && capturedStopId) {
        socket.emit('unsubscribe:station', capturedStopId);
        prevStopIdRef.current = null;
      }
    };
  }, [socket, stopId]);

  // --- Socket event listeners ---
  useEffect(() => {
    if (!socket || !socketActive) return;

    function handleArrivalsUpdate(data: {
      stationId: string;
      arrivals: ArrivalBoard['arrivals'];
      updatedAt: string;
    }) {
      // Only process updates for the subscribed station
      if (data.stationId !== stopId) return;

      setSocketArrivals({
        stopId: data.stationId,
        stopName: null,
        updatedAt: data.updatedAt,
        now: new Date().toISOString(),
        arrivals: data.arrivals,
      });
    }

    socket.on('arrivals:update', handleArrivalsUpdate);

    return () => {
      socket.off('arrivals:update', handleArrivalsUpdate);
    };
  }, [socket, socketActive, stopId]);

  // --- React Query polling (disabled when socket is active) ---
  const usePolling = enabled && !socketActive;

  const query = useQuery({
    queryKey: queryKeys.arrivals(groupId, stopId),
    queryFn: () => mtaApi.getArrivals(groupId, stopId),
    enabled: usePolling && !!groupId && !!stopId,
    refetchInterval: usePolling ? refreshInterval : false,
    staleTime: refreshInterval / 2,
  });

  const refetch = useCallback(() => {
    if (socketActive && socket?.connected) {
      // Re-subscribe to force a fresh push
      socket.emit('subscribe:station', stopId);
      return Promise.resolve();
    }
    return query.refetch();
  }, [socketActive, socket, stopId, query]);

  const arrivals = socketActive ? socketArrivals : query.data;

  return {
    arrivals,
    isLoading: socketActive
      ? !socketArrivals
      : query.isLoading,
    error: socketActive ? null : query.error?.message || null,
    refetch,
  };
}
