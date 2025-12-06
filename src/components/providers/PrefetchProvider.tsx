'use client';

import { usePrefetchStaticData } from '@/hooks/use-prefetch-static-data';
import { useBackgroundSync } from '@/hooks/use-background-sync';
import type { ReactNode } from 'react';

interface PrefetchProviderProps {
  children: ReactNode;
}

export function PrefetchProvider({ children }: PrefetchProviderProps) {
  // Prefetch static data on dashboard mount
  usePrefetchStaticData();

  // Keep train/alert data fresh in background across all pages
  useBackgroundSync();

  return <>{children}</>;
}
