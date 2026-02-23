'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Background sync hook - keeps critical data fresh across all pages
 *
 * - On map page: trains polling is handled by useTrainPositions (15s)
 * - On other pages: Background refresh every 30s to keep cache warm,
 *   but only if the trains query is not already actively polling
 * - Alerts: Always refresh every 60s regardless of page
 */
export function useBackgroundSync() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const isMapPage = pathname === '/map';
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // On map page, train positions are handled by useTrainPositions.
    // Only do background sync on other pages.
    if (!isMapPage) {
      intervalRef.current = setInterval(() => {
        // Check if the trains query already has active observers (i.e. another
        // component is polling). If so, skip — that query's refetchInterval
        // already keeps the cache warm.
        const trainsQuery = queryClient.getQueryState(queryKeys.trains);
        const hasActiveObservers =
          (queryClient.getQueryCache().find({ queryKey: queryKeys.trains })?.getObserversCount() ?? 0) > 0;

        if (hasActiveObservers && trainsQuery && !trainsQuery.isInvalidated) {
          return; // Another component is actively polling trains
        }

        queryClient.prefetchQuery({
          queryKey: queryKeys.trains,
          queryFn: mtaApi.getTrains,
          staleTime: 15000,
        });
      }, 30000);

      // Immediate prefetch when leaving the map (only if cache is stale)
      const trainsState = queryClient.getQueryState(queryKeys.trains);
      const isStale = !trainsState || Date.now() - (trainsState.dataUpdatedAt ?? 0) > 15000;
      if (isStale) {
        queryClient.prefetchQuery({
          queryKey: queryKeys.trains,
          queryFn: mtaApi.getTrains,
          staleTime: 15000,
        });
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isMapPage, queryClient]);

  // Always keep alerts fresh (every 60s on all pages)
  useEffect(() => {
    const alertInterval = setInterval(() => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.alerts(),
        queryFn: () => mtaApi.getAlerts(),
        staleTime: 30000,
      });
    }, 60000);

    return () => clearInterval(alertInterval);
  }, [queryClient]);
}
