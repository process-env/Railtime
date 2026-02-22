'use client';

import { useMemo } from 'react';
import { useRidership } from './use-ridership';
import { calculateImpactFromRidership } from '@/lib/analytics/impact-calculator';

export function useImpactMetrics() {
  const { data: ridership, isLoading, error } = useRidership(30);

  const metrics = useMemo(() => {
    if (!ridership?.latest) return null;
    return calculateImpactFromRidership(ridership.latest.ridership);
  }, [ridership]);

  return {
    economic: metrics?.economic ?? null,
    environmental: metrics?.environmental ?? null,
    dailyRidership: ridership?.latest?.ridership ?? null,
    dailyFareRevenue: ridership?.dailyFareRevenue ?? null,
    carbonSavedToday: metrics?.environmental?.totalCO2SavedTons ?? null,
    isLoading,
    error,
  };
}
