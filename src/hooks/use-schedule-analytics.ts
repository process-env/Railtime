'use client';

import { useQuery } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { ScheduleData, RouteScheduleStats } from '@/lib/mta/load-stop-times';

/**
 * Hook to fetch schedule statistics from GTFS static data.
 * This data is cached for a very long time since it only changes
 * when the GTFS feed is updated.
 */
export function useScheduleAnalytics() {
  const query = useQuery<ScheduleData>({
    queryKey: queryKeys.schedule,
    queryFn: mtaApi.getScheduleStats,
    staleTime: Infinity, // Static data - never goes stale
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch schedule for a specific route.
 */
export function useRouteSchedule(routeId: string | null) {
  const query = useQuery<RouteScheduleStats>({
    queryKey: queryKeys.routeSchedule(routeId || ''),
    queryFn: () => mtaApi.getRouteSchedule(routeId!),
    enabled: !!routeId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error?.message || null,
  };
}
