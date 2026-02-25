'use client';

import { useQuery, useSubscription } from '@apollo/client';
import {
  GET_ROUTE_METRICS,
  GET_DAILY_ROLLUPS,
  GET_LATEST_SYSTEM_HEALTH,
  ON_ROUTE_METRIC_UPDATE,
  GET_TRIP_EVENTS,
} from '@/lib/graphql/queries';
import { isAppSyncConfigured } from '@/lib/graphql/client';
import type {
  GetRouteMetricsData,
  GetDailyRollupsData,
  GetLatestSystemHealthData,
  OnRouteMetricUpdateData,
  GetTripEventsData,
} from '@/lib/graphql/types';

/**
 * Fetch route metrics for a specific route within a time range.
 * @param routeId - Route ID (e.g. "A", "1", "L")
 * @param from - Start timestamp (epoch seconds)
 * @param to - End timestamp (epoch seconds)
 * @param direction - Optional direction filter (e.g. "N", "S")
 */
export function useRouteMetrics(routeId: string, from: number, to: number, direction?: string) {
  return useQuery<GetRouteMetricsData>(GET_ROUTE_METRICS, {
    variables: { routeId, direction: direction ?? null, from, to },
    skip: !isAppSyncConfigured || !routeId || !from || !to,
  });
}

/**
 * Fetch daily rollups for all routes or a specific route within a date range.
 * @param from - Start date "YYYY-MM-DD"
 * @param to - End date "YYYY-MM-DD"
 * @param routeId - Optional route filter
 * @param direction - Optional direction filter (e.g. "N", "S")
 */
export function useDailyRollups(from: string, to: string, routeId?: string, direction?: string) {
  return useQuery<GetDailyRollupsData>(GET_DAILY_ROLLUPS, {
    variables: { routeId: routeId ?? null, direction: direction ?? null, from, to },
    skip: !isAppSyncConfigured || !from || !to,
  });
}

/**
 * Fetch the latest system health snapshot. Polls every 60s.
 */
export function useSystemHealth() {
  return useQuery<GetLatestSystemHealthData>(GET_LATEST_SYSTEM_HEALTH, {
    pollInterval: 60_000,
    skip: !isAppSyncConfigured,
  });
}

/**
 * Subscribe to real-time route metric updates via AppSync.
 * @param routeId - Optional route filter (null = all routes)
 */
export function useRouteMetricSubscription(routeId?: string) {
  return useSubscription<OnRouteMetricUpdateData>(ON_ROUTE_METRIC_UPDATE, {
    variables: { routeId: routeId ?? null },
    skip: !isAppSyncConfigured,
  });
}

/**
 * Fetch trip events (TRIP_START/TRIP_END) for a route within a time range.
 */
export function useTripEvents(routeId: string, from: number, to: number, direction?: string, eventType?: string) {
  return useQuery<GetTripEventsData>(GET_TRIP_EVENTS, {
    variables: {
      routeId,
      direction: direction ?? null,
      from,
      to,
      eventType: eventType ?? null,
    },
    skip: !isAppSyncConfigured || !routeId || !from || !to,
  });
}
