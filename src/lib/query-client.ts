'use client';

import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes default
        gcTime: 1000 * 60 * 30, // 30 minutes - keep data longer for navigation
        refetchOnWindowFocus: false, // Disable for this real-time app
        retry: 2, // Retry failed requests twice
        refetchOnMount: 'always', // Always check for fresh data on mount
      },
    },
  });
}
