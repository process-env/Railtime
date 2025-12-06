'use client';

import { useQuery } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

interface UseArrivalsOptions {
  refreshInterval?: number;
  enabled?: boolean;
}

export function useArrivals(
  groupId: string,
  stopId: string,
  options: UseArrivalsOptions = {}
) {
  const { refreshInterval = 30000, enabled = true } = options;

  const query = useQuery({
    queryKey: queryKeys.arrivals(groupId, stopId),
    queryFn: () => mtaApi.getArrivals(groupId, stopId),
    enabled: enabled && !!groupId && !!stopId,
    refetchInterval: enabled ? refreshInterval : false,
    staleTime: refreshInterval / 2,
  });

  return {
    arrivals: query.data,
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch: query.refetch,
  };
}
