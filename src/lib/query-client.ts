'use client';

import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes default
        gcTime: 1000 * 60 * 10, // 10 minutes garbage collection
        refetchOnWindowFocus: false, // Disable for this real-time app
        retry: 2, // Retry failed requests twice
      },
    },
  });
}
