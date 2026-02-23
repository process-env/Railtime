'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';

export interface AnomalyEvent {
  pk: string;           // e.g. "BUNCH#A#N", "GAP#7#S", "DELAY#Q#N"
  timestamp: number;    // epoch ms
  description?: string;
  delaySeconds?: number;
}

export interface AnomalyFeedResponse {
  events: AnomalyEvent[];
  count: number;
}

interface UseAnomalyFeedOptions {
  routeId?: string;
  type?: 'BUNCH' | 'GAP' | 'DELAY';
  limit?: number;
}

export function useAnomalyFeed(options: UseAnomalyFeedOptions = {}) {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  const { routeId, type, limit = 50 } = options;

  return useQuery<AnomalyFeedResponse>({
    queryKey: [...queryKeys.anomalyFeed, routeId ?? 'all', type ?? 'all', limit],
    queryFn: async (): Promise<AnomalyFeedResponse> => {
      if (!wsUrl) throw new Error('WebSocket server URL not configured');

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (routeId) params.set('routeId', routeId);
      if (type) params.set('type', type);

      const res = await fetch(`${wsUrl}/api/anomaly-feed?${params}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      return res.json();
    },
    enabled: !!wsUrl,
    refetchInterval: 30_000,   // Poll every 30s
    staleTime: 15_000,         // 15s stale window
    gcTime: 60_000,            // 1 min garbage collection
    retry: 1,
  });
}
