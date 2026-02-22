'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { mtaApi } from '@/lib/api';

export function useRidership(days: number = 30) {
  return useQuery({
    queryKey: queryKeys.ridership(days),
    queryFn: () => mtaApi.getRidership(days),
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
  });
}
