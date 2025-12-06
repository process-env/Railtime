'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAlertsStore } from '@/stores';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
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

export function useAlerts(options: UseAlertsOptions = {}): UseAlertsReturn {
  const { refreshInterval = 60000, enabled = true, routeIds } = options;
  const { dismissedIds, dismissAlert, clearDismissed } = useAlertsStore();

  const query = useQuery({
    queryKey: queryKeys.alerts(routeIds),
    queryFn: () => mtaApi.getAlerts(routeIds),
    enabled,
    refetchInterval: enabled ? refreshInterval : false,
    staleTime: refreshInterval / 2,
    refetchIntervalInBackground: false, // Pause when page hidden
  });

  const alerts: ServiceAlert[] = query.data?.alerts || [];

  // Compute active alerts (within active period)
  const activeAlerts = useMemo(() => {
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
  }, [alerts]);

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
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch: query.refetch,
    counts,
    dismissAlert,
    clearDismissed,
  };
}
