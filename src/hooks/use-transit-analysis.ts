'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitAnalysisResponse {
  analysis: string;
  generatedAt: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-refresh interval: 10 minutes */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Faster polling when the server returns a 202 pending placeholder */
const PENDING_POLL_MS = 30_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransitAnalysis() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

  return useQuery<TransitAnalysisResponse>({
    queryKey: queryKeys.transitAnalysis,
    queryFn: async (): Promise<TransitAnalysisResponse> => {
      if (!wsUrl) throw new Error('WebSocket server URL not configured');

      const res = await fetch(`${wsUrl}/api/transit-analysis`);

      // 202 returns valid JSON with a "pending" placeholder — don't treat as error
      if (!res.ok && res.status !== 202) {
        throw new Error(`Server responded with ${res.status}`);
      }

      return res.json();
    },
    enabled: !!wsUrl,
    refetchInterval: (query) => {
      // If we got a pending response, poll faster to catch the real analysis
      if (query.state.data?.model === 'pending') return PENDING_POLL_MS;
      return REFRESH_INTERVAL_MS;
    },
    staleTime: REFRESH_INTERVAL_MS / 2, // 5 min stale window
    gcTime: REFRESH_INTERVAL_MS * 1.5, // 15 min garbage collection
    retry: 1,
  });
}
