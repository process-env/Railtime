'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAlertsStore } from '@/stores';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import { useSocket } from '@/components/providers/SocketProvider';
import type { ServiceAlert } from '@/types/mta';

interface UseAlertsOptions {
  refreshInterval?: number;
  enabled?: boolean;
  routeIds?: string[];
}

interface UseAlertsReturn {
  alerts: ServiceAlert[];
  visibleAlerts: ServiceAlert[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<unknown>;
  counts: { critical: number; warning: number; info: number };
  dismissAlert: (id: string) => void;
  clearDismissed: () => void;
}

/** Threshold in ms before falling back to polling after socket disconnect */
const FALLBACK_DELAY_MS = 30_000;

export function useAlerts(options: UseAlertsOptions = {}): UseAlertsReturn {
  const { refreshInterval = 60000, enabled = true, routeIds } = options;
  const { dismissedIds, dismissAlert, clearDismissed } = useAlertsStore();
  const { socket, isConnected } = useSocket();
  const queryClient = useQueryClient();

  const [socketActive, setSocketActive] = useState(false);
  const disconnectedAtRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Socket-pushed alerts
  const [socketAlerts, setSocketAlerts] = useState<ServiceAlert[]>([]);

  // --- Socket lifecycle ---
  useEffect(() => {
    if (!socket || !enabled) return;

    if (isConnected) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      disconnectedAtRef.current = null;

      socket.emit('subscribe:all');
      queueMicrotask(() => setSocketActive(true));
    } else {
      if (disconnectedAtRef.current === null) {
        disconnectedAtRef.current = Date.now();
      }

      fallbackTimerRef.current = setTimeout(() => {
        setSocketActive(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts(routeIds) });
      }, FALLBACK_DELAY_MS);
    }

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [socket, isConnected, enabled, queryClient, routeIds]);

  // --- Socket event listeners ---
  useEffect(() => {
    if (!socket || !socketActive) return;

    function handleAlertsUpdate(data: {
      alerts: ServiceAlert[];
      updatedAt: string;
    }) {
      // Filter by routeIds if specified (same as server-side filtering for polling)
      let alerts = data.alerts;
      if (routeIds?.length) {
        alerts = alerts.filter((a) =>
          a.affectedRoutes.some((r) => routeIds.includes(r))
        );
      }
      setSocketAlerts(alerts);
    }

    function handleAlertNew(data: { alert: ServiceAlert }) {
      setSocketAlerts((prev) => {
        // Add if not already present
        if (prev.some((a) => a.id === data.alert.id)) return prev;
        // Apply routeId filter
        if (
          routeIds?.length &&
          !data.alert.affectedRoutes.some((r) => routeIds.includes(r))
        ) {
          return prev;
        }
        return [...prev, data.alert];
      });
    }

    function handleAlertCleared(data: { alertId: string }) {
      setSocketAlerts((prev) => prev.filter((a) => a.id !== data.alertId));
    }

    socket.on('alerts:update', handleAlertsUpdate);
    socket.on('alerts:new', handleAlertNew);
    socket.on('alerts:cleared', handleAlertCleared);

    return () => {
      socket.off('alerts:update', handleAlertsUpdate);
      socket.off('alerts:new', handleAlertNew);
      socket.off('alerts:cleared', handleAlertCleared);
    };
  }, [socket, socketActive, routeIds]);

  // --- React Query polling (disabled when socket is active) ---
  const usePolling = enabled && !socketActive;

  const query = useQuery({
    queryKey: queryKeys.alerts(routeIds),
    queryFn: () => mtaApi.getAlerts(routeIds),
    enabled: usePolling,
    refetchInterval: usePolling ? refreshInterval : false,
    staleTime: refreshInterval / 2,
    refetchIntervalInBackground: false,
  });

  // --- Choose raw alerts source ---
  const rawAlerts = socketActive ? socketAlerts : query.data?.alerts;

  // Compute active alerts (within active period)
  const activeAlerts = useMemo(() => {
    const alerts: ServiceAlert[] = rawAlerts || [];
    const now = new Date();
    return alerts.filter((alert) => {
      if (!alert.activePeriods.length) return true;
      return alert.activePeriods.some((period) => {
        const start = new Date(period.start);
        const end = period.end ? new Date(period.end) : null;
        if (now < start) return false;
        if (end && now > end) return false;
        return true;
      });
    });
  }, [rawAlerts]);

  // Compute visible alerts (not dismissed)
  const visibleAlerts = useMemo(() => {
    return activeAlerts.filter((alert) => !dismissedIds.has(alert.id));
  }, [activeAlerts, dismissedIds]);

  // Compute counts
  const counts = useMemo(
    () => ({
      critical: activeAlerts.filter((a) => a.severity === 'critical').length,
      warning: activeAlerts.filter((a) => a.severity === 'warning').length,
      info: activeAlerts.filter((a) => a.severity === 'info').length,
    }),
    [activeAlerts]
  );

  return {
    alerts: activeAlerts,
    visibleAlerts,
    isLoading: socketActive
      ? socketAlerts.length === 0 && !rawAlerts
      : query.isLoading,
    error: socketActive ? null : query.error?.message || null,
    refetch: query.refetch,
    counts,
    dismissAlert,
    clearDismissed,
  };
}
