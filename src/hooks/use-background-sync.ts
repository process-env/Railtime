'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Background sync hook - keeps critical data fresh across all pages
 *
 * - On map page: Full refresh every 15s (handled by useTrainPositions)
 * - On other pages: Background refresh every 30s to keep cache warm
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

    // On map page, train positions are handled by useTrainPositions
    // Only do background sync on other pages
    if (!isMapPage) {
      // Background refresh trains every 30s when not on map
      intervalRef.current = setInterval(() => {
        queryClient.prefetchQuery({
          queryKey: queryKeys.trains,
          queryFn: mtaApi.getTrains,
          staleTime: 15000, // Same as map page
        });
      }, 30000);

      // Also do an immediate prefetch when leaving the map
      queryClient.prefetchQuery({
        queryKey: queryKeys.trains,
        queryFn: mtaApi.getTrains,
        staleTime: 15000,
      });
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
