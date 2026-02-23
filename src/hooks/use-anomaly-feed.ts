'use client';

import { useQuery } from '@tanstack/react-query';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

export interface AnomalyEvent {
  pk: string;           // e.g. "BUNCH#A#N", "GAP#7#S", "DELAY#Q#N"
  timestamp: number;    // epoch ms
  description?: string;
  delaySeconds?: number;
  stopId?: string;      // GTFS stop ID where anomaly detected
}

export interface AnomalyFeedResponse {
  events: AnomalyEvent[];
  count: number;
}

export function useAnomalyFeed() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

  return useQuery<AnomalyFeedResponse>({
    queryKey: queryKeys.anomalyFeed,
    queryFn: () => mtaApi.getAnomalyFeed(),
    enabled: !!wsUrl,
    refetchInterval: 30_000,   // Poll every 30s
    staleTime: 15_000,         // 15s stale window
    gcTime: 60_000,            // 1 min garbage collection
    retry: 1,
  });
}
