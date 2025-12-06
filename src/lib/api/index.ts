import type { Stop, Route, TrainPosition, ServiceAlert, ArrivalBoard } from '@/types/mta';
import type { EquipmentStatusResponse } from '@/types/equipment';

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
};
