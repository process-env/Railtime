'use client';

import { useQuery, useSubscription } from '@apollo/client';
import {
  GET_ROUTE_METRICS,
  GET_DAILY_ROLLUPS,
  GET_LATEST_SYSTEM_HEALTH,
  ON_ROUTE_METRIC_UPDATE,
} from '@/lib/graphql/queries';
import type {
  GetRouteMetricsData,
  GetDailyRollupsData,
  GetLatestSystemHealthData,
  OnRouteMetricUpdateData,
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
    skip: !routeId || !from || !to,
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
    skip: !from || !to,
  });
}

/**
 * Fetch the latest system health snapshot. Polls every 60s.
 */
export function useSystemHealth() {
  return useQuery<GetLatestSystemHealthData>(GET_LATEST_SYSTEM_HEALTH, {
    pollInterval: 60_000,
  });
}

/**
 * Subscribe to real-time route metric updates via AppSync.
 * @param routeId - Optional route filter (null = all routes)
 */
export function useRouteMetricSubscription(routeId?: string) {
  return useSubscription<OnRouteMetricUpdateData>(ON_ROUTE_METRIC_UPDATE, {
    variables: { routeId: routeId ?? null },
  });
}
