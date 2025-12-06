'use client';

import { useQuery } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { TrainPosition } from '@/types/mta';

interface UseTrainPositionsOptions {
  refreshInterval?: number;
  enabled?: boolean;
}

export function useTrainPositions(options: UseTrainPositionsOptions = {}) {
  const { refreshInterval = 15000, enabled = true } = options;

  const query = useQuery({
    queryKey: queryKeys.trains,
    queryFn: mtaApi.getTrains,
    enabled,
    refetchInterval: enabled ? refreshInterval : false,
    staleTime: refreshInterval / 2, // Consider stale after half the refresh interval
    gcTime: refreshInterval * 2,
  });

  return {
    trains: (query.data?.trains || []) as TrainPosition[],
    updatedAt: query.data?.updatedAt,
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch: query.refetch,
  };
}
