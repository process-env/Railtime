// ---------------------------------------------------------------------------
// Server-local type definitions
// Replicated from src/types/mta.ts because the server is a separate package
// and cannot import from the Next.js app.
// ---------------------------------------------------------------------------

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string | null;
  parent: string | null;
}

export interface StopUpdate {
  stopId: string | null;
  stopName: string | null;
  arrival: { time: string | null; delay: number | null };
  departure: { time: string | null; delay: number | null };
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

export interface TrainPosition {
  tripId: string;
  routeId: string;
  lat: number;
  lon: number;
  heading: number;
  nextStopId: string;
  nextStopName: string;
  eta: string;
  headsign: string;
  prevStopId: string;
  prevTimeMs: number;
  nextTimeMs: number;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface ServiceAlert {
  id: string;
  alertType: string;
  severity: AlertSeverity;
  headerText: string;
  descriptionHtml: string;
  affectedRoutes: string[];
  affectedStops: string[];
  affectedStopNames?: string[];
  activePeriods: Array<{ start: string; end?: string }>;
  createdAt: string;
  updatedAt: string;
}

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

// ---------------------------------------------------------------------------
// Feed group definition
// ---------------------------------------------------------------------------

export interface FeedGroupConfig {
  id: string;
  url: string;
  routes: string[];
}

// ---------------------------------------------------------------------------
// Shared analytics types
// ---------------------------------------------------------------------------

export interface AlertSummary {
  id: string;
  headerText: string;
  affectedRoutes: string[];
}
