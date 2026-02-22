export interface RouteMetric {
  routeId: string;
  direction: string | null;
  timestamp: number;
  trainCount: number;
  avgDelaySeconds: number | null;
  onTimePercent: number | null;
  headwayAvgSeconds: number | null;
  headwayMedianSeconds: number | null;
  bunchingCount: number | null;
  gapCount: number | null;
  feedLatencyMs: number | null;
  feedStatus: string | null;
}

export interface DailyRollup {
  routeId: string;
  date: string;
  direction: string | null;
  avgDelay: number | null;
  onTimePercent: number | null;
  peakTrainCount: number | null;
  totalAlerts: number | null;
  avgHeadway: number | null;
  medianHeadway: number | null;
  totalBunching: number | null;
  totalGaps: number | null;
  totalSkippedStops: number | null;
  totalTrips: number | null;
}

export interface FeedGroupHealth {
  feedGroupId: string;
  status: string;
  latencyMs: number | null;
  trainCount: number | null;
}

export interface SystemHealth {
  timestamp: number;
  activeTrains: number;
  feedGroups: FeedGroupHealth[];
  alertCount: number;
  onTimePercent: number | null;
}

export interface GetRouteMetricsData {
  getRouteMetrics: RouteMetric[];
}

export interface GetDailyRollupsData {
  getDailyRollups: DailyRollup[];
}

export interface GetLatestSystemHealthData {
  getLatestSystemHealth: SystemHealth | null;
}

export interface OnRouteMetricUpdateData {
  onRouteMetricUpdate: RouteMetric;
}
