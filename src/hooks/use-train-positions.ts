'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import { useSocket } from '@/components/providers/SocketProvider';
import { connectNamespaceSocket, type TrainsSocket } from '@/lib/socket/client';
import { useTrainsStore } from '@/stores';
import type { TrainPosition } from '@/types/mta';
import type { TrainsDelta, ViewportBounds } from '@/types/ws-events';

interface UseTrainPositionsOptions {
  refreshInterval?: number;
  enabled?: boolean;
  viewport?: ViewportBounds | null;
}

/** Threshold in ms before falling back to polling after socket disconnect */
const FALLBACK_DELAY_MS = 5_000;

export function useTrainPositions(options: UseTrainPositionsOptions = {}) {
  const { refreshInterval = 15000, enabled = true, viewport = null } = options;

  // We only use the root socket context to check if WS is available at all
  const { isAvailable } = useSocket();

  // Per-namespace socket state for /trains
  const [socket, setSocket] = useState<TrainsSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const queryClient = useQueryClient();
  const updateTrains = useTrainsStore((s) => s.updateTrains);
  const removeTrains = useTrainsStore((s) => s.removeTrains);

  // Track whether we have active socket data flowing
  const [socketActive, setSocketActive] = useState(false);
  const disconnectedAtRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track socket-pushed data locally so the return value stays reactive
  const [socketTrains, setSocketTrains] = useState<TrainPosition[]>([]);
  const [socketUpdatedAt, setSocketUpdatedAt] = useState<string | undefined>();

  // Track whether we've received the initial snapshot (for ghost cleanup)
  const hasSnapshotRef = useRef(false);

  // --- Connect to /trains namespace ---
  useEffect(() => {
    if (!isAvailable || !enabled) return;

    const s = connectNamespaceSocket<TrainsSocket>('/trains');
    if (!s) return;

    function onConnect() {
      setIsConnected(true);
      setSocket(s);
    }
    function onDisconnect() {
      setIsConnected(false);
      hasSnapshotRef.current = false; // Will need fresh snapshot on reconnect
    }

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    if (s.connected) {
      onConnect();
    } else {
      // Set socket before connect so consumers can attach listeners
      queueMicrotask(() => setSocket(s));
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, [isAvailable, enabled]);

  // --- Socket lifecycle (subscribe / fallback) ---
  useEffect(() => {
    if (!socket || !enabled) return;

    if (isConnected) {
      // Clear any pending fallback timer
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      disconnectedAtRef.current = null;

      // Subscribe — server will send snapshot immediately for ghost cleanup
      if (viewport) {
        socket.emit('subscribe:viewport', viewport);
      } else {
        socket.emit('subscribe:all');
      }
      queueMicrotask(() => setSocketActive(true));
    } else {
      // Socket disconnected — start fallback timer
      if (disconnectedAtRef.current === null) {
        disconnectedAtRef.current = Date.now();
      }

      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
      fallbackTimerRef.current = setTimeout(() => {
        setSocketActive(false);
        // Invalidate React Query cache so polling picks up fresh data
        queryClient.invalidateQueries({ queryKey: queryKeys.trains });
      }, FALLBACK_DELAY_MS);
    }

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [socket, isConnected, enabled, queryClient, viewport]);

  // --- Send viewport updates when viewport changes ---
  useEffect(() => {
    if (!socket || !isConnected || !socketActive || !viewport) return;
    socket.emit('subscribe:viewport', viewport);
  }, [socket, isConnected, socketActive, viewport]);

  // --- Socket event listeners ---
  useEffect(() => {
    if (!socket || !socketActive) return;

    // Full snapshot — used on initial connect and reconnect for ghost cleanup
    function handleSnapshot(data: { trains: TrainPosition[]; updatedAt: string }) {
      const snapshotMap = new Map(data.trains.map((t) => [t.tripId, t]));

      // Ghost cleanup: remove local trains that aren't in the snapshot
      setSocketTrains((prev) => {
        if (prev.length > 0) {
          const ghostIds = prev
            .filter((t) => !snapshotMap.has(t.tripId))
            .map((t) => t.tripId);
          if (ghostIds.length > 0) {
            removeTrains(ghostIds);
          }
        }
        return data.trains;
      });

      updateTrains(data.trains);
      setSocketUpdatedAt(data.updatedAt);
      hasSnapshotRef.current = true;
    }

    // Delta update — incremental changes only
    function handleDelta(data: TrainsDelta) {
      if (!hasSnapshotRef.current) return; // Wait for snapshot first

      // Apply additions and updates to Zustand
      const changed = [...data.added, ...data.updated];
      if (changed.length > 0) {
        updateTrains(changed);
      }

      // Apply removals
      if (data.removed.length > 0) {
        removeTrains(data.removed);
      }

      // Update local reactive state
      setSocketTrains((prev) => {
        const map = new Map(prev.map((t) => [t.tripId, t]));

        for (const train of data.added) map.set(train.tripId, train);
        for (const train of data.updated) map.set(train.tripId, train);
        for (const id of data.removed) map.delete(id);

        return Array.from(map.values());
      });
      setSocketUpdatedAt(data.updatedAt);
    }

    // Legacy full update (fallback for route-specific rooms)
    function handleTrainsUpdate(data: {
      feedGroupId: string;
      trains: TrainPosition[];
      updatedAt: string;
      stale: boolean;
    }) {
      updateTrains(data.trains);
      setSocketTrains((prev) => {
        const map = new Map(prev.map((t) => [t.tripId, t]));
        for (const train of data.trains) {
          map.set(train.tripId, train);
        }
        return Array.from(map.values());
      });
      setSocketUpdatedAt(data.updatedAt);
    }

    function handleTrainsRemove(data: { tripIds: string[] }) {
      removeTrains(data.tripIds);
      setSocketTrains((prev) => {
        const removeSet = new Set(data.tripIds);
        return prev.filter((t) => !removeSet.has(t.tripId));
      });
    }

    socket.on('trains:snapshot', handleSnapshot);
    socket.on('trains:delta', handleDelta);
    socket.on('trains:update', handleTrainsUpdate);
    socket.on('trains:remove', handleTrainsRemove);

    return () => {
      socket.off('trains:snapshot', handleSnapshot);
      socket.off('trains:delta', handleDelta);
      socket.off('trains:update', handleTrainsUpdate);
      socket.off('trains:remove', handleTrainsRemove);
    };
  }, [socket, socketActive, updateTrains, removeTrains]);

  // --- React Query polling (disabled when socket is active) ---
  const usePolling = enabled && !socketActive;

  const query = useQuery({
    queryKey: queryKeys.trains,
    queryFn: mtaApi.getTrains,
    enabled: usePolling,
    refetchInterval: usePolling ? refreshInterval : false,
    staleTime: refreshInterval / 2,
    gcTime: refreshInterval * 2,
  });

  // Refetch callable regardless of mode
  const refetch = useCallback(() => {
    if (socketActive && socket?.connected) {
      // Re-subscribe to force a fresh push
      socket.emit('subscribe:all');
      return Promise.resolve();
    }
    return query.refetch();
  }, [socketActive, socket, query]);

  // --- Return the same shape regardless of data source ---
  if (socketActive) {
    // Use polling data as seed while waiting for first socket push
    const trains = socketTrains.length > 0
      ? socketTrains
      : (query.data?.trains || []) as TrainPosition[];
    return {
      trains,
      updatedAt: socketUpdatedAt ?? query.data?.updatedAt,
      isLoading: trains.length === 0,
      error: null,
      refetch,
    };
  }

  return {
    trains: (query.data?.trains || []) as TrainPosition[],
    updatedAt: query.data?.updatedAt,
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch,
  };
}
