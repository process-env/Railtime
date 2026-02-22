'use client';

import { useMemo } from 'react';
import { getRidershipForDate } from '@/lib/analytics/ridership-lookup';
import { calculateImpactFromRidership } from '@/lib/analytics/impact-calculator';

export function useImpactMetrics() {
  const today = useMemo(() => getRidershipForDate(), []);

  const metrics = useMemo(() => {
    return calculateImpactFromRidership(today.ridership);
  }, [today.ridership]);

  return {
    economic: metrics.economic,
    environmental: metrics.environmental,
    dailyRidership: today.ridership,
    dailyFareRevenue: today.dailyFareRevenue,
    carbonSavedToday: metrics.environmental.totalCO2SavedTons,
    isLoading: false,
    error: null,
  };
}
