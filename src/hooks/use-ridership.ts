'use client';

import { useMemo } from 'react';
import { getRidershipForDate, getRidershipRange } from '@/lib/analytics/ridership-lookup';

export function useRidership(days: number = 30) {
  const data = useMemo(() => {
    const today = getRidershipForDate();
    const range = getRidershipRange(days);
    const totalRidership = range.reduce((sum, d) => sum + d.ridership, 0);
    const avgDaily = range.length > 0 ? Math.round(totalRidership / range.length) : 0;

    return {
      days: range.map(d => ({
        date: d.date,
        ridership: d.ridership,
        prePandemicPercent: d.prePandemicPercent,
      })),
      latest: {
        date: today.date,
        ridership: today.ridership,
        prePandemicPercent: today.prePandemicPercent,
      },
      avgDaily,
      totalRidership,
      dailyFareRevenue: today.dailyFareRevenue,
      updatedAt: new Date().toISOString(),
    };
  }, [days]);

  return {
    data,
    isLoading: false,
    error: null,
  };
}
