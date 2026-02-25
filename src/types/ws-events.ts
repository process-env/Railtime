import type { TrainPosition, ArrivalItem, ServiceAlert } from './mta';

// ---------------------------------------------------------------------------
// Trains namespace
// ---------------------------------------------------------------------------

/** Delta update payload — only changed trains instead of full array. */
export interface TrainsDelta {
  feedGroupId: string;
  added: TrainPosition[];
  updated: TrainPosition[];
  removed: string[];
  updatedAt: string;
  stale: boolean;
}

/** Viewport bounds for adaptive push frequency. */
export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

export interface TrainsServerToClientEvents {
  'trains:update': (data: {
    feedGroupId: string;
    trains: TrainPosition[];
    updatedAt: string;
    stale: boolean;
  }) => void;
  'trains:delta': (data: TrainsDelta) => void;
  'trains:snapshot': (data: {
    trains: TrainPosition[];
    updatedAt: string;
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
  'subscribe:viewport': (bounds: ViewportBounds) => void;
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
