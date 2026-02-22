'use client';

import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { Train, Users, DollarSign, Activity, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  StatsCard,
  DelayTrendChart,
  RoutePerformanceTable,
  SystemHealthTimeline,
  EconomicImpactCard,
  EnvironmentalImpactCard,
  RidershipTrendChart,
  RidershipStatsCard,
  FeedStatusCard,
  AlertStatusCard,
  RouteActivityChart,
  RouteProfileCard,
  ServiceSpanCard,
  ScheduleFrequencyCard,
  BusiestStationsCard,
  TrainHistoryChart,
  DelayDistributionChart,
  ArrivalsTimelineChart,
  EquipmentStatusCard,
  TripCompletionChart,
  LiveSystemDashboard,
} from '@/components/analytics';
import { ErrorBoundary, ChartErrorFallback } from '@/components/ErrorBoundary';
import { useAnalytics, useAlerts } from '@/hooks';
import { useImpactMetrics } from '@/hooks/use-impact-metrics';
import { useDailyRollups } from '@/hooks/use-analytics-data';
import { useScheduleAnalytics } from '@/hooks/use-schedule-analytics';

export default function AnalyticsPage() {
  const { data, loading, error, refresh } = useAnalytics();
  const { alerts } = useAlerts();
  const alertCount = alerts?.length ?? 0;
  const {
    economic,
    environmental,
    dailyRidership,
    dailyFareRevenue,
    carbonSavedToday,
    isLoading: impactLoading,
  } = useImpactMetrics();
  const rollupTo = format(new Date(), 'yyyy-MM-dd');
  const rollupFrom = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  const { data: rollupData, loading: rollupLoading } = useDailyRollups(rollupFrom, rollupTo);
  const { data: scheduleData, isLoading: scheduleLoading } = useScheduleAnalytics();

  const systemOnTime = useMemo(() => {
    const rollups = rollupData?.getDailyRollups ?? [];
    const onTimes = rollups
      .map(r => r.onTimePercent)
      .filter((v): v is number => v != null);
    if (onTimes.length === 0) return null;
    return Math.round((onTimes.reduce((a, b) => a + b, 0) / onTimes.length) * 10) / 10;
  }, [rollupData]);

  // Build activeTrains map for RouteProfileCard
  const activeTrains = useMemo(() => {
    const map: Record<string, number> = {};
    if (data?.routeActivity) {
      for (const r of data.routeActivity) {
        map[r.routeId] = r.trainCount;
      }
    }
    return map;
  }, [data?.routeActivity]);

  // Build TrainHistoryChart data with valid ISO timestamps
  // (useAnalytics returns locale-formatted time strings like "12:27 PM"
  //  which are not parseable by new Date(), causing date-fns format() to throw)
  const trainHistoryData = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    return data.timeline.map((t, i) => ({
      time: new Date(now.getTime() - (data.timeline.length - 1 - i) * 5 * 60 * 1000).toISOString(),
      trainCount: t.arrivals,
      routeCount: 0,
    }));
  }, [data]);

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

      {/* Stats Grid (always visible above tabs) */}
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
            description="Estimated from ridership"
          />
        )}

        {rollupLoading ? (
          <Skeleton className="h-[100px]" />
        ) : (
          <StatsCard
            title="System On-Time %"
            value={systemOnTime != null ? `${systemOnTime}%` : '--'}
            icon={Activity}
            description="7-day average across all routes"
          />
        )}
      </div>

      {/* Tabbed Dashboard */}
      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">System Overview</TabsTrigger>
          <TabsTrigger value="routes">Route Performance</TabsTrigger>
          <TabsTrigger value="ridership">Ridership & Impact</TabsTrigger>
          <TabsTrigger value="trips">Trip Intelligence</TabsTrigger>
          <TabsTrigger value="schedule">Schedule & Stations</TabsTrigger>
        </TabsList>

        {/* Tab 1: System Overview */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          <ErrorBoundary fallback={<ChartErrorFallback />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LiveSystemDashboard
                totalTrains={data?.stats.totalTrains ?? 0}
                feedStatus={data?.feedStatus ?? []}
                alertCount={alertCount}
                loading={loading}
              />
              <AlertStatusCard />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SystemHealthTimeline />
              {data ? <FeedStatusCard feeds={data.feedStatus} /> : <Skeleton className="h-[300px]" />}
            </div>
          </ErrorBoundary>
        </TabsContent>

        {/* Tab 2: Route Performance */}
        <TabsContent value="routes" className="space-y-6 mt-4">
          <ErrorBoundary fallback={<ChartErrorFallback />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DelayTrendChart />
              {data ? <RouteActivityChart data={data.routeActivity} /> : <Skeleton className="h-[300px]" />}
            </div>
            <RoutePerformanceTable />
            {scheduleData ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <RouteProfileCard routeStats={scheduleData.routeStats} activeTrains={activeTrains} />
                <ServiceSpanCard routeStats={scheduleData.routeStats} serviceDay={scheduleData.serviceDay} />
              </div>
            ) : scheduleLoading ? (
              <Skeleton className="h-[300px]" />
            ) : null}
          </ErrorBoundary>
        </TabsContent>

        {/* Tab 3: Ridership & Impact */}
        <TabsContent value="ridership" className="space-y-6 mt-4">
          <ErrorBoundary fallback={<ChartErrorFallback />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <EnvironmentalImpactCard impact={environmental} loading={impactLoading} />
              <EconomicImpactCard impact={economic} loading={impactLoading} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RidershipTrendChart />
              <RidershipStatsCard />
            </div>
            <EquipmentStatusCard />
          </ErrorBoundary>
        </TabsContent>

        {/* Tab 4: Trip Intelligence */}
        <TabsContent value="trips" className="space-y-6 mt-4">
          <ErrorBoundary fallback={<ChartErrorFallback />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TripCompletionChart />
              {trainHistoryData.length > 0 ? <TrainHistoryChart data={trainHistoryData} /> : <Skeleton className="h-[300px]" />}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DelayDistributionChart />
              <ArrivalsTimelineChart />
            </div>
          </ErrorBoundary>
        </TabsContent>

        {/* Tab 5: Schedule & Stations */}
        <TabsContent value="schedule" className="space-y-6 mt-4">
          <ErrorBoundary fallback={<ChartErrorFallback />}>
            {scheduleData ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ScheduleFrequencyCard routeStats={scheduleData.routeStats} serviceDay={scheduleData.serviceDay} />
                  <BusiestStationsCard stations={scheduleData.busiestStations} />
                </div>
                {data ? (
                  <RouteActivityChart data={data.routeActivity} />
                ) : null}
              </>
            ) : scheduleLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-[400px]" />
                <Skeleton className="h-[400px]" />
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Schedule data unavailable
              </div>
            )}
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
