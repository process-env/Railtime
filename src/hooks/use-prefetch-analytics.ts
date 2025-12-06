'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import { FEED_GROUPS } from '@/lib/constants';

export function usePrefetchAnalytics() {
  const queryClient = useQueryClient();

  const prefetch = useCallback(() => {
    // Prefetch all feed statuses in parallel
    FEED_GROUPS.forEach((group) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.feedStatus(group.id),
        queryFn: () => mtaApi.getFeedStatus(group.id),
        staleTime: 30000,
      });
    });

    // Historical data prefetch DISABLED - causes 49s+ load times
    // queryClient.prefetchQuery({
    //   queryKey: queryKeys.historical(24),
    //   queryFn: () => mtaApi.getHistoricalData(24),
    //   staleTime: 5 * 60 * 1000,
    // });
  }, [queryClient]);

  return prefetch;
}
