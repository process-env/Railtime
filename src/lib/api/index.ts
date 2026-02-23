import type { Stop, Route, TrainPosition, ServiceAlert, ArrivalBoard } from '@/types/mta';
import type { EquipmentStatusResponse } from '@/types/equipment';
import type { TripPlanResponse } from '@/lib/trip-planner/types';
import type { TransitAnalysisResponse } from '@/hooks/use-transit-analysis';
import type { AnomalyFeedResponse } from '@/hooks/use-anomaly-feed';


// Centralized API service layer
export const mtaApi = {
  // Static data
  getStops: async (): Promise<Stop[]> => {
    const res = await fetch('/api/v1/stops');
    if (!res.ok) throw new Error('Failed to fetch stops');
    return res.json();
  },

  getRoutes: async (): Promise<Route[]> => {
    const res = await fetch('/api/v1/routes');
    if (!res.ok) throw new Error('Failed to fetch routes');
    return res.json();
  },

  getEnrichedStations: async (): Promise<Record<string, { enrichedName: string; crossStreet?: string }>> => {
    const res = await fetch('/data/stations-enriched.json');
    if (!res.ok) return {};
    return res.json();
  },

  // Real-time data
  getTrains: async (): Promise<{ trains: TrainPosition[]; updatedAt: string }> => {
    const res = await fetch('/api/v1/trains');
    if (!res.ok) throw new Error('Failed to fetch trains');
    return res.json();
  },

  getAlerts: async (routeIds?: string[]): Promise<{ alerts: ServiceAlert[] }> => {
    let url = '/api/v1/alerts';
    if (routeIds?.length) {
      url += `?route=${routeIds.join(',')}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch alerts');
    return res.json();
  },

  getArrivals: async (groupId: string, stopId: string): Promise<ArrivalBoard> => {
    const res = await fetch(`/api/v1/arrivals/${groupId}/${stopId}`);
    if (!res.ok) throw new Error('Failed to fetch arrivals');
    return res.json();
  },

  // Feed status (for analytics)
  getFeedStatus: async (groupId: string): Promise<{
    feedId: string;
    lastPoll: string;
    tripCount: number;
    status: 'healthy' | 'stale' | 'error';
  }> => {
    try {
      const res = await fetch(`/api/v1/feed/${groupId}`);
      if (res.ok) {
        const data = await res.json();
        return {
          feedId: groupId,
          lastPoll: new Date().toISOString(),
          tripCount: Array.isArray(data) ? data.length : 0,
          status: 'healthy',
        };
      }
      return {
        feedId: groupId,
        lastPoll: new Date().toISOString(),
        tripCount: 0,
        status: 'error',
      };
    } catch {
      return {
        feedId: groupId,
        lastPoll: new Date().toISOString(),
        tripCount: 0,
        status: 'error',
      };
    }
  },

  // Historical analytics
  getHistoricalData: async (hours: number = 24) => {
    const res = await fetch(`/api/v1/analytics/historical?hours=${hours}`);
    if (!res.ok) throw new Error('Failed to fetch historical data');
    return res.json();
  },

  // Schedule data (GTFS static)
  getScheduleStats: async () => {
    const res = await fetch('/api/v1/schedule');
    if (!res.ok) throw new Error('Failed to fetch schedule stats');
    return res.json();
  },

  getRouteSchedule: async (routeId: string) => {
    const res = await fetch(`/api/v1/schedule?routeId=${routeId}`);
    if (!res.ok) throw new Error('Failed to fetch route schedule');
    return res.json();
  },

  // Equipment (Elevator & Escalator) status
  getEquipmentStatus: async (): Promise<EquipmentStatusResponse> => {
    const res = await fetch('/api/v1/equipment');
    if (!res.ok) throw new Error('Failed to fetch equipment status');
    return res.json();
  },

  // WS server endpoints (transit analysis & anomaly feed)
  getTransitAnalysis: async (): Promise<TransitAnalysisResponse> => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) throw new Error('WebSocket server URL not configured');

    const res = await fetch(`${wsUrl}/api/transit-analysis`);
    // 202 returns valid JSON with a "pending" placeholder — don't treat as error
    if (!res.ok && res.status !== 202) {
      throw new Error(`Server responded with ${res.status}`);
    }
    return res.json();
  },

  getAnomalyFeed: async (limit: number = 200): Promise<AnomalyFeedResponse> => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) throw new Error('WebSocket server URL not configured');

    const res = await fetch(`${wsUrl}/api/anomaly-feed?limit=${limit}`);
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    return res.json();
  },

  // Trip planning
  planTrip: async (params: {
    origin: string;
    destination: string;
    alternatives?: number;
    maxTransfers?: number;
    avoidRoutes?: string[];
  }): Promise<TripPlanResponse> => {
    const searchParams = new URLSearchParams({
      origin: params.origin,
      destination: params.destination,
      alternatives: String(params.alternatives ?? 3),
    });

    if (params.maxTransfers !== undefined) {
      searchParams.set('maxTransfers', String(params.maxTransfers));
    }

    if (params.avoidRoutes && params.avoidRoutes.length > 0) {
      searchParams.set('avoidRoutes', params.avoidRoutes.join(','));
    }

    const res = await fetch(`/api/v1/trip?${searchParams}`);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `Failed to plan trip (${res.status})`
      );
    }

    return res.json();
  },

};
