'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Prefetch map data on hover/focus
 * - Train positions (latest)
 * - Alerts for speed modulation
 */
export function usePrefetchMap() {
  const queryClient = useQueryClient();

  const prefetch = useCallback(() => {
    // Prefetch train positions
    queryClient.prefetchQuery({
      queryKey: queryKeys.trains,
      queryFn: mtaApi.getTrains,
      staleTime: 7500, // Half of refresh interval
    });

    // Prefetch alerts
    queryClient.prefetchQuery({
      queryKey: queryKeys.alerts(),
      queryFn: () => mtaApi.getAlerts(),
      staleTime: 30000,
    });
  }, [queryClient]);

  return prefetch;
}
