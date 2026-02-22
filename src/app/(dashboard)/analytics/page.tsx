'use client';

import { Train, Users, Leaf, DollarSign, Activity, RefreshCw, History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  StatsCard,
  DelayTrendChart,
  RoutePerformanceTable,
  SystemHealthTimeline,
  EconomicImpactCard,
  EnvironmentalImpactCard,
  RidershipTrendChart,
  RidershipStatsCard,
} from '@/components/analytics';
import { useAnalytics } from '@/hooks/use-analytics';
import { useImpactMetrics } from '@/hooks/use-impact-metrics';
import { useSystemHealth } from '@/hooks/use-analytics-data';

export default function AnalyticsPage() {
  const { data, loading, error, refresh } = useAnalytics();
  const {
    economic,
    environmental,
    dailyRidership,
    dailyFareRevenue,
    carbonSavedToday,
    isLoading: impactLoading,
  } = useImpactMetrics();
  const { data: healthData, loading: healthLoading } = useSystemHealth();

  const systemOnTime = healthData?.getLatestSystemHealth?.onTimePercent;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <p className="text-destructive">Error: {error}</p>
          <Button onClick={refresh}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto overflow-x-hidden h-full w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transit Intelligence</h1>
          <p className="text-muted-foreground">
            Real-time system metrics, ridership analytics, and impact data
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <Skeleton className="h-[100px]" />
        ) : data ? (
          <StatsCard
            title="Active Trains"
            value={data.stats.totalTrains}
            icon={Train}
            description="Currently running"
          />
        ) : null}

        {impactLoading ? (
          <Skeleton className="h-[100px]" />
        ) : (
          <StatsCard
            title="Daily Ridership"
            value={dailyRidership != null ? dailyRidership.toLocaleString() : '--'}
            icon={Users}
            description="MTA subway system"
          />
        )}

        {impactLoading ? (
          <Skeleton className="h-[100px]" />
        ) : (
          <StatsCard
            title="Daily Fare Revenue"
            value={dailyFareRevenue != null ? `$${(dailyFareRevenue / 1_000_000).toFixed(1)}M` : '--'}
            icon={DollarSign}
            description="Estimated from ridership × $3.00 fare"
          />
        )}

        {healthLoading ? (
          <Skeleton className="h-[100px]" />
        ) : (
          <StatsCard
            title="System On-Time %"
            value={systemOnTime != null ? `${systemOnTime}%` : '--'}
            icon={Activity}
            description="Across all routes"
          />
        )}
      </div>

      {/* Environmental & Economic Impact */}
      <div className="border-t pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Leaf className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Environmental & Economic Impact</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EnvironmentalImpactCard impact={environmental} loading={impactLoading} />
          <EconomicImpactCard impact={economic} loading={impactLoading} />
        </div>
      </div>

      {/* Ridership Intelligence */}
      <div className="border-t pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Ridership Intelligence</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RidershipTrendChart />
          <RidershipStatsCard />
        </div>
      </div>

      {/* Historical Performance */}
      <div className="border-t pt-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Historical Performance</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DelayTrendChart />
          <SystemHealthTimeline />
        </div>
        <div className="mt-6">
          <RoutePerformanceTable />
        </div>
      </div>
    </div>
  );
}
