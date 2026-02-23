'use client';

import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import {
  OperationalStatsBar,
  TransitAnalysisCard,
  AnomalyFeed,
  BestWorstRouteCard,
  AlertStatusCard,
  RoutePerformanceTable,
  BunchingGapTrendChart,
  SystemHealthTimeline,
  DelayTrendChart,
  DelayDistributionChart,
  TripCompletionChart,
  LiveSystemDashboard,
} from '@/components/analytics';
import { ErrorBoundary, ChartErrorFallback } from '@/components/ErrorBoundary';
import { useAnalytics, useAlerts } from '@/hooks';
import { useDailyRollups } from '@/hooks/use-analytics-data';

export default function AnalyticsPage() {
  const { data, loading } = useAnalytics();
  const { alerts } = useAlerts();
  const alertCount = alerts?.length ?? 0;

  // Shared 30-day rollup query — all chart components filter from this superset
  const { from, to } = useMemo(() => ({
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  }), []);

  const { data: rollupData, loading: rollupLoading } = useDailyRollups(from, to);
  const sharedRollup = useMemo(
    () => ({ data: rollupData, loading: rollupLoading }),
    [rollupData, rollupLoading]
  );

  return (
    <div className="p-6 space-y-6 overflow-y-auto overflow-x-hidden h-full w-full">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Operational Intelligence</h1>
        <p className="text-muted-foreground">
          Real-time anomaly detection, route health, and AI-powered transit insights
        </p>
      </div>

      {/* Stats Bar */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <OperationalStatsBar />
      </ErrorBoundary>

      {/* AI Transit Insights */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <TransitAnalysisCard />
      </ErrorBoundary>

      {/* Anomaly Feed + Route Health */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AnomalyFeed />
          <div className="space-y-6">
            <BestWorstRouteCard rollupData={sharedRollup} />
            <AlertStatusCard />
          </div>
        </div>
      </ErrorBoundary>

      {/* Route Performance Table */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <RoutePerformanceTable rollupData={sharedRollup} />
      </ErrorBoundary>

      {/* Trend Charts Row 1 */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BunchingGapTrendChart rollupData={sharedRollup} />
          <SystemHealthTimeline rollupData={sharedRollup} />
        </div>
      </ErrorBoundary>

      {/* Trend Charts Row 2 */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DelayTrendChart rollupData={sharedRollup} />
          <DelayDistributionChart rollupData={sharedRollup} />
        </div>
      </ErrorBoundary>

      {/* Bottom Row */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TripCompletionChart rollupData={sharedRollup} />
          <LiveSystemDashboard
            totalTrains={data?.stats.totalTrains ?? 0}
            feedStatus={data?.feedStatus ?? []}
            alertCount={alertCount}
            loading={loading}
          />
        </div>
      </ErrorBoundary>
    </div>
  );
}
