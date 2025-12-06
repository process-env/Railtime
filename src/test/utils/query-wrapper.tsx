import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Create a QueryClient optimized for testing
 * - No retries (tests should fail fast)
 * - Immediate garbage collection
 * - No stale time (always fetch fresh)
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * Wrapper component for testing hooks and components that use React Query
 *
 * Usage in renderHook:
 * ```ts
 * const { result } = renderHook(() => useMyHook(), { wrapper: QueryWrapper });
 * ```
 *
 * Usage in render:
 * ```ts
 * render(<MyComponent />, { wrapper: QueryWrapper });
 * ```
 */
export function QueryWrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

/**
 * Create a wrapper with a specific QueryClient instance
 * Useful when you need to inspect or manipulate the cache
 *
 * Usage:
 * ```ts
 * const queryClient = createTestQueryClient();
 * const { result } = renderHook(() => useMyHook(), {
 *   wrapper: createQueryWrapper(queryClient)
 * });
 * // Later: queryClient.getQueryData(['key'])
 * ```
 */
export function createQueryWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}
