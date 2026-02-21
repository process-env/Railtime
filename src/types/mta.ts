// Route data from routes.txt
export interface Route {
  route_id: string;
  short_name: string;
  long_name: string;
  desc: string | null;
  type: string;
  color: string | null;
  text_color: string | null;
}

// Stop data from stops.txt
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string | null;
  parent: string | null;
  enrichedName?: string; // Cross-street enriched name from TomTom API
  crossStreet?: string; // Direct cross street name
}

// Alias for Station (same as Stop)
export type Station = Stop;

// Feed groups
export interface FeedGroup {
  id: string;
  url: string;
  routes: string[];
}

// GTFS-RT parsed entities
export interface StopUpdate {
  stopId: string | null;
  stopName: string | null;
  arrival: {
    time: string | null;
    delay: number | null;
  };
  departure: {
    time: string | null;
    delay: number | null;
  };
  scheduleRelationship: string | null;
}

export interface FeedEntity {
  id: string | null;
  routeId: string | null;
  tripId: string | null;
  startDate: string | null;
  vehicleId: string | null;
  stopUpdates: StopUpdate[];
  timestamp: string | null;
}

// Arrival board item
export interface ArrivalItem {
  stopId: string;
  stopName: string | null;
  whenISO: string;
  whenLocal: string | null;
  in: string;
  routeId: string | null;
  tripId: string | null;
  scheduleRelationship: string | null;
  meta: {
    arrivalDelay: number | null;
    departureDelay: number | null;
  };
}

// Arrival board response
export interface ArrivalBoard {
  stopId: string;
  stopName: string | null;
  updatedAt: string | null;
  now: string;
  arrivals: ArrivalItem[];
}

// Train position for map
export interface TrainPosition {
  tripId: string;
  routeId: string;
  lat: number;
  lon: number;
  heading: number;
  nextStopId: string;
  nextStopName: string;
  eta: string;
  headsign?: string;
  // New fields for motion planning
  prevStopId?: string;      // Previous stop (train departed from)
  prevTimeMs?: number;      // Departure time from prev stop (epoch ms)
  nextTimeMs?: number;      // Arrival time at next stop (epoch ms)
}

// WebSocket events
export interface TrainsUpdateEvent {
  feedGroupId: string;
  trains: TrainPosition[];
}

export interface ArrivalsUpdateEvent {
  stationId: string;
  arrivals: ArrivalItem[];
  updatedAt: string;
}

export interface FeedStatusEvent {
  feedGroupId: string;
  status: 'success' | 'error' | 'timeout';
  timestamp: string;
}

// Service alerts
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface ServiceAlert {
  id: string;
  alertType?: string;
  severity: AlertSeverity;
  headerText: string;
  descriptionHtml: string;
  affectedRoutes?: string[];
  affectedStops?: string[];
  affectedStopNames?: string[];
  activePeriods?: Array<{ start: string; end?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AlertsResponse {
  alerts: ServiceAlert[];
  updatedAt: string;
}
