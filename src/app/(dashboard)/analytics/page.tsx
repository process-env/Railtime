'use client';

import { useMemo } from 'react';
import { Train, Users, Leaf, Activity, RefreshCw, Calendar, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RouteActivityChart,
  FeedStatusCard,
  StatsCard,
  ScheduleFrequencyCard,
  BusiestStationsCard,
  RouteProfileCard,
  ServiceSpanCard,
  EquipmentStatusCard,
  DelayTrendChart,
  RoutePerformanceTable,
  SystemHealthTimeline,
  EconomicImpactCard,
  EnvironmentalImpactCard,
  RidershipTrendChart,
  RidershipStatsCard,
} from '@/components/analytics';
import { useAnalytics } from '@/hooks/use-analytics';
import { useScheduleAnalytics } from '@/hooks/use-schedule-analytics';
import { useImpactMetrics } from '@/hooks/use-impact-metrics';
import { useSystemHealth } from '@/hooks/use-analytics-data';

export default function AnalyticsPage() {
  const { data, loading, error, refresh } = useAnalytics();
  const {
    data: scheduleData,
    isLoading: scheduleLoading,
    error: scheduleError,
  } = useScheduleAnalytics();
  const {
    economic,
    environmental,
    dailyRidership,
    carbonSavedToday,
    isLoading: impactLoading,
  } = useImpactMetrics();
  const { data: healthData, loading: healthLoading } = useSystemHealth();

  // Calculate active trains per route for route profile
  const routeActivity = data?.routeActivity;
  const activeTrainsByRoute = useMemo(() => {
    if (!routeActivity) return {};
    return routeActivity.reduce(
      (acc, r) => {
        acc[r.routeId] = r.trainCount;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [routeActivity]);

  // Extract system on-time %
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
            description="MTA Socrata data"
          />
        )}

        {impactLoading ? (
          <Skeleton className="h-[100px]" />
        ) : (
          <StatsCard
            title="Carbon Saved Today"
            value={carbonSavedToday != null ? `${carbonSavedToday} tonnes` : '--'}
            icon={Leaf}
            description="CO₂ emissions prevented"
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

      {/* Schedule Intelligence */}
      <div className="border-t pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Schedule Intelligence</h2>
          {scheduleData && (
            <span className="text-sm text-muted-foreground ml-2">
              ({scheduleData.serviceDay} schedule • {scheduleData.totalTrips.toLocaleString()} trips)
            </span>
          )}
        </div>

        {scheduleLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-[400px]" />
            <Skeleton className="h-[400px]" />
          </div>
        ) : scheduleError ? (
          <div className="p-4 text-center text-muted-foreground">
            Failed to load schedule data
          </div>
        ) : scheduleData ? (
          <>
            {/* Service Hours Overview */}
            <ServiceSpanCard
              routeStats={scheduleData.routeStats}
              serviceDay={scheduleData.serviceDay}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              {/* Schedule Frequency */}
              <ScheduleFrequencyCard
                routeStats={scheduleData.routeStats}
                serviceDay={scheduleData.serviceDay}
              />

              {/* Route Profile */}
              <RouteProfileCard
                routeStats={scheduleData.routeStats}
                activeTrains={activeTrainsByRoute}
              />
            </div>

            {/* Busiest Stations */}
            <div className="mt-6">
              <BusiestStationsCard stations={scheduleData.busiestStations} />
            </div>
          </>
        ) : null}
      </div>

      {/* System Status */}
      <div className="border-t pt-6">
        <h2 className="text-xl font-semibold mb-4">System Status</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Train Count by Route</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[300px]" />
              ) : data ? (
                <RouteActivityChart data={data.routeActivity} />
              ) : null}
            </CardContent>
          </Card>
          <EquipmentStatusCard />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {loading ? (
            <Skeleton className="h-[300px]" />
          ) : data ? (
            <FeedStatusCard feeds={data.feedStatus} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
