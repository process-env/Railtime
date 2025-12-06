'use client';

import { useQuery } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

export function useEquipmentStatus() {
  const query = useQuery({
    queryKey: queryKeys.equipment,
    queryFn: mtaApi.getEquipmentStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes (matches server cache)
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch: query.refetch,
  };
}
