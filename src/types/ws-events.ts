import type { TrainPosition, ArrivalItem, ServiceAlert } from './mta';

// ---------------------------------------------------------------------------
// Trains namespace
// ---------------------------------------------------------------------------

export interface TrainsServerToClientEvents {
  'trains:update': (data: {
    feedGroupId: string;
    trains: TrainPosition[];
    updatedAt: string;
    stale: boolean;
  }) => void;
  'trains:remove': (data: {
    tripIds: string[];
  }) => void;
  'feed:status': (data: {
    feedGroupId: string;
    status: 'success' | 'error' | 'timeout';
    tripCount: number;
    latencyMs: number;
  }) => void;
}

export interface TrainsClientToServerEvents {
  'subscribe:all': () => void;
  'subscribe:route': (routeId: string) => void;
  'unsubscribe:route': (routeId: string) => void;
}

// ---------------------------------------------------------------------------
// Alerts namespace
// ---------------------------------------------------------------------------

export interface AlertsServerToClientEvents {
  'alerts:update': (data: {
    alerts: ServiceAlert[];
    updatedAt: string;
  }) => void;
  'alerts:new': (data: {
    alert: ServiceAlert;
  }) => void;
  'alerts:cleared': (data: {
    alertId: string;
  }) => void;
}

export interface AlertsClientToServerEvents {
  'subscribe:all': () => void;
  'subscribe:route': (routeId: string) => void;
}

// ---------------------------------------------------------------------------
// Arrivals namespace
// ---------------------------------------------------------------------------

export interface ArrivalsServerToClientEvents {
  'arrivals:update': (data: {
    stationId: string;
    arrivals: ArrivalItem[];
    updatedAt: string;
  }) => void;
}

export interface ArrivalsClientToServerEvents {
  'subscribe:station': (stationId: string) => void;
  'unsubscribe:station': (stationId: string) => void;
}

// ---------------------------------------------------------------------------
// Combined events (for a single Socket.IO server that handles all namespaces)
// ---------------------------------------------------------------------------

export interface ServerToClientEvents
  extends TrainsServerToClientEvents,
    AlertsServerToClientEvents,
    ArrivalsServerToClientEvents {}

export interface ClientToServerEvents
  extends TrainsClientToServerEvents,
    AlertsClientToServerEvents,
    ArrivalsClientToServerEvents {}
