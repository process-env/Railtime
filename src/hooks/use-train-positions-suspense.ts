'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { TrainPosition } from '@/types/mta';

interface UseTrainPositionsSuspenseOptions {
  refreshInterval?: number;
}

/**
 * Suspense-enabled train positions hook
 * - Suspends on initial load (shows fallback)
 * - After initial load, updates in background
 * - Use with prefetch for instant navigation
 */
export function useTrainPositionsSuspense(options: UseTrainPositionsSuspenseOptions = {}) {
  const { refreshInterval = 15000 } = options;

  const query = useSuspenseQuery({
    queryKey: queryKeys.trains,
    queryFn: mtaApi.getTrains,
    refetchInterval: refreshInterval,
    staleTime: refreshInterval / 2,
    gcTime: refreshInterval * 2,
  });

  return {
    trains: (query.data?.trains || []) as TrainPosition[],
    updatedAt: query.data?.updatedAt,
    refetch: query.refetch,
  };
}
