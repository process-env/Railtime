'use client';

import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { useAnalytics } from './use-analytics';
import { useAlerts } from './use-alerts';
import { useDailyRollups } from './use-analytics-data';

export interface OperationalStats {
  activeTrains: number;
  onTimePercent: number | null;
  bunchingToday: number;
  gapsToday: number;
  alertCount: number;
  feedHealth: number;
  loading: boolean;
}

export function useOperationalStats(): OperationalStats {
  const { data, loading: analyticsLoading } = useAnalytics();
  const { alerts } = useAlerts();
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const { data: rollupData, loading: rollupLoading } = useDailyRollups(yesterday, today);

  return useMemo(() => {
    const rollups = rollupData?.getDailyRollups ?? [];

    // Count distinct routes affected (not raw cumulative instances)
    const todayRollups = rollups.filter(r => r.date?.startsWith(today));
    const routesWithBunching = new Set(
      todayRollups.filter(r => (r.totalBunching ?? 0) > 0).map(r => r.routeId)
    );
    const routesWithGaps = new Set(
      todayRollups.filter(r => (r.totalGaps ?? 0) > 0).map(r => r.routeId)
    );
    const bunchingToday = routesWithBunching.size;
    const gapsToday = routesWithGaps.size;

    // Average on-time percent
    const onTimes = rollups
      .map(r => r.onTimePercent)
      .filter((v): v is number => v != null);
    const onTimePercent = onTimes.length > 0
      ? Math.round((onTimes.reduce((a, b) => a + b, 0) / onTimes.length) * 10) / 10
      : null;

    return {
      activeTrains: data?.stats.totalTrains ?? 0,
      onTimePercent,
      bunchingToday,
      gapsToday,
      alertCount: alerts?.length ?? 0,
      feedHealth: data?.stats.feedHealth ?? 0,
      loading: analyticsLoading || rollupLoading,
    };
  }, [data, alerts, rollupData, today, analyticsLoading, rollupLoading]);
}
