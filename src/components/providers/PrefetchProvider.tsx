'use client';

import { usePrefetchStaticData } from '@/hooks/use-prefetch-static-data';
import type { ReactNode } from 'react';

interface PrefetchProviderProps {
  children: ReactNode;
}

export function PrefetchProvider({ children }: PrefetchProviderProps) {
  // Prefetch static data on dashboard mount
  usePrefetchStaticData();
  return <>{children}</>;
}
