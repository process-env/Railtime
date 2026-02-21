import { gql } from '@apollo/client';

export const GET_ROUTE_METRICS = gql`
  query GetRouteMetrics($routeId: String!, $from: AWSTimestamp!, $to: AWSTimestamp!) {
    getRouteMetrics(routeId: $routeId, from: $from, to: $to) {
      routeId
      timestamp
      trainCount
      avgDelaySeconds
      onTimePercent
      headwayAvgSeconds
      feedLatencyMs
      feedStatus
    }
  }
`;

export const GET_DAILY_ROLLUPS = gql`
  query GetDailyRollups($routeId: String, $from: String!, $to: String!) {
    getDailyRollups(routeId: $routeId, from: $from, to: $to) {
      routeId
      date
      avgDelay
      onTimePercent
      peakTrainCount
      totalAlerts
      avgHeadway
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
      timestamp
      trainCount
      avgDelaySeconds
      onTimePercent
      headwayAvgSeconds
      feedLatencyMs
      feedStatus
    }
  }
`;
