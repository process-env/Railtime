'use client';

import { useMemo } from 'react';
import { Train, MapPin, Clock, Activity, RefreshCw, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RouteActivityChart,
  FeedStatusCard,
  StatsCard,
  AlertStatusCard,
  ScheduleFrequencyCard,
  BusiestStationsCard,
  RouteProfileCard,
  ServiceSpanCard,
  EquipmentStatusCard,
} from '@/components/analytics';
import { useAnalytics } from '@/hooks/use-analytics';
import { useScheduleAnalytics } from '@/hooks/use-schedule-analytics';

export default function AnalyticsPage() {
  // Real-time data from useAnalytics hook
  const { data, loading, error, refresh } = useAnalytics();

  // Schedule data from GTFS static
  const {
    data: scheduleData,
    isLoading: scheduleLoading,
    error: scheduleError,
  } = useScheduleAnalytics();

  // Calculate active trains per route for route profile
  const activeTrainsByRoute = useMemo(() => {
    if (!data?.routeActivity) return {};
    return data.routeActivity.reduce(
      (acc, r) => {
        acc[r.routeId] = r.trainCount;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [data?.routeActivity]);

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
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">
            Real-time subway system metrics and performance
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
          <>
            <Skeleton className="h-[100px]" />
            <Skeleton className="h-[100px]" />
            <Skeleton className="h-[100px]" />
            <Skeleton className="h-[100px]" />
          </>
        ) : data ? (
          <>
            <StatsCard
              title="Active Trains"
              value={data.stats.totalTrains}
              icon={Train}
              description="Currently running"
            />
            <StatsCard
              title="Stations"
              value={data.stats.totalStations}
              icon={MapPin}
              description="Across all lines"
            />
            <StatsCard
              title="Avg Delay"
              value={`${data.stats.avgDelay} min`}
              icon={Clock}
              description="System-wide"
            />
            <StatsCard
              title="Feed Health"
              value={`${data.stats.feedHealth}%`}
              icon={Activity}
              description="Data sources active"
            />
          </>
        ) : null}
      </div>

      {/* Schedule Intelligence Section */}
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

      {/* Real-Time Performance Section */}
      <div className="border-t pt-6">
        <h2 className="text-xl font-semibold mb-4">Real-Time Performance</h2>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Route Activity */}
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

          {/* Equipment Status */}
          <EquipmentStatusCard />
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Feed Status */}
          {loading ? (
            <Skeleton className="h-[300px]" />
          ) : data ? (
            <FeedStatusCard feeds={data.feedStatus} />
          ) : null}

          {/* Alert Status */}
          <AlertStatusCard />
        </div>
      </div>

    </div>
  );
}
