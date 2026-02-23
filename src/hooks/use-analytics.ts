'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import { useTrainPositions } from './use-train-positions';
import { ALL_ROUTES, FEED_GROUPS } from '@/lib/constants';

interface RouteActivityData {
  routeId: string;
  trainCount: number;
}

/**
 * Timeline data placeholder. Currently null because the historical data
 * endpoint is disabled for performance reasons. This type is retained so the
 * field can be populated when a lightweight historical source is available.
 */
interface TimelineData {
  time: string;
  arrivals: number;
  departures: number;
}

interface FeedStatus {
  feedId: string;
  lastPoll: string;
  tripCount: number;
  status: 'healthy' | 'stale' | 'error';
}

interface AnalyticsData {
  routeActivity: RouteActivityData[];
  /** Null until a lightweight historical data source is available. */
  timeline: TimelineData[] | null;
  feedStatus: FeedStatus[];
  stats: {
    totalTrains: number;
    totalStations: number;
    avgDelay: number;
    feedHealth: number;
  };
}

export function useAnalytics() {
  // Get trains from React Query cache (shares data with map page)
  const { trains } = useTrainPositions({ enabled: true });

  // PARALLEL feed status queries - fixes sequential loop issue!
  // Before: for loop with await (sequential)
  // After: useQueries (parallel)
  const feedQueries = useQueries({
    queries: FEED_GROUPS.map((group) => ({
      queryKey: queryKeys.feedStatus(group.id),
      queryFn: () => mtaApi.getFeedStatus(group.id),
      staleTime: 30000,
      refetchInterval: 30000,
    })),
  });

  // Historical data query DISABLED - was causing 2+ minute load times
  // const historicalQuery = useQuery({
  //   queryKey: queryKeys.historical(24),
  //   queryFn: () => mtaApi.getHistoricalData(24),
  //   staleTime: 5 * 60 * 1000,
  //   gcTime: 30 * 60 * 1000,
  // });

  // Compute route activity from trains
  const routeActivity = useMemo<RouteActivityData[]>(() => {
    const routeCounts = new Map<string, number>();
    ALL_ROUTES.forEach((r) => routeCounts.set(r, 0));

    trains.forEach((train) => {
      const route = train.routeId.toUpperCase();
      if (routeCounts.has(route)) {
        routeCounts.set(route, (routeCounts.get(route) || 0) + 1);
      }
    });

    return ALL_ROUTES.map((routeId) => ({
      routeId,
      trainCount: routeCounts.get(routeId) || 0,
    }));
  }, [trains]);

  // Timeline data disabled — the historical endpoint causes 2+ minute load
  // times. Set to null rather than fabricating flat data from the current
  // train count, which was misleading.
  const timeline: TimelineData[] | null = null;

  // Compute feed status from parallel queries
  // Note: Using stable fallback timestamp to avoid memoization breaks
  const feedStatus = useMemo<FeedStatus[]>(() => {
    const fallbackTimestamp = new Date().toISOString();
    return feedQueries.map((q, i) => {
      if (q.data) return q.data;
      return {
        feedId: FEED_GROUPS[i].id,
        lastPoll: fallbackTimestamp,
        tripCount: 0,
        status: q.isLoading ? ('stale' as const) : ('error' as const),
      };
    });
  }, [feedQueries]);

  const isLoading = feedQueries.some((q) => q.isLoading);
  const healthyFeeds = feedStatus.filter((f) => f.status === 'healthy').length;

  // Average delay - placeholder (historical disabled)
  const avgDelay = 2;

  const data = useMemo<AnalyticsData>(
    () => ({
      routeActivity,
      timeline,
      feedStatus,
      stats: {
        totalTrains: trains.length,
        totalStations: 472,
        avgDelay,
        feedHealth: Math.round((healthyFeeds / FEED_GROUPS.length) * 100),
      },
    }),
    [routeActivity, feedStatus, trains.length, avgDelay, healthyFeeds]
  );

  return {
    data,
    loading: isLoading,
    error: null,
    refresh: () => {
      feedQueries.forEach((q) => q.refetch());
    },
  };
}
