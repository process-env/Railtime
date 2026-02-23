'use client';

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

export default function AnalyticsPage() {
  const { data, loading } = useAnalytics();
  const { alerts } = useAlerts();
  const alertCount = alerts?.length ?? 0;

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
            <BestWorstRouteCard />
            <AlertStatusCard />
          </div>
        </div>
      </ErrorBoundary>

      {/* Route Performance Table */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <RoutePerformanceTable />
      </ErrorBoundary>

      {/* Trend Charts Row 1 */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BunchingGapTrendChart />
          <SystemHealthTimeline />
        </div>
      </ErrorBoundary>

      {/* Trend Charts Row 2 */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DelayTrendChart />
          <DelayDistributionChart />
        </div>
      </ErrorBoundary>

      {/* Bottom Row */}
      <ErrorBoundary fallback={<ChartErrorFallback />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TripCompletionChart />
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
