import { gql } from '@apollo/client';

export const GET_ROUTE_METRICS = gql`
  query GetRouteMetrics($routeId: String!, $direction: String, $from: AWSTimestamp!, $to: AWSTimestamp!) {
    getRouteMetrics(routeId: $routeId, direction: $direction, from: $from, to: $to) {
      routeId
      direction
      timestamp
      trainCount
      avgDelaySeconds
      onTimePercent
      headwayAvgSeconds
      headwayMedianSeconds
      bunchingCount
      gapCount
      feedLatencyMs
      feedStatus
    }
  }
`;

export const GET_DAILY_ROLLUPS = gql`
  query GetDailyRollups($routeId: String, $direction: String, $from: String!, $to: String!) {
    getDailyRollups(routeId: $routeId, direction: $direction, from: $from, to: $to) {
      routeId
      date
      direction
      avgDelay
      onTimePercent
      peakTrainCount
      totalAlerts
      avgHeadway
      medianHeadway
      totalBunching
      totalGaps
      totalSkippedStops
      totalTrips
    }
  }
`;

export const GET_LATEST_SYSTEM_HEALTH = gql`
  query GetLatestSystemHealth {
    getLatestSystemHealth {
      timestamp
      activeTrains
      feedGroups {
        feedGroupId
        status
        latencyMs
        trainCount
      }
      alertCount
    }
  }
`;

export const ON_ROUTE_METRIC_UPDATE = gql`
  subscription OnRouteMetricUpdate($routeId: String) {
    onRouteMetricUpdate(routeId: $routeId) {
      routeId
      direction
      timestamp
      trainCount
      avgDelaySeconds
      onTimePercent
      headwayAvgSeconds
      headwayMedianSeconds
      bunchingCount
      gapCount
      feedLatencyMs
      feedStatus
    }
  }
`;
