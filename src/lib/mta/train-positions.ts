import type { FeedEntity, TrainPosition, Stop } from '@/types/mta';
import { loadStops } from './load-stops';
import { getTripHeadsignWithFallback } from './load-trips';
import { validateHeadsign } from './format';

/**
 * Calculate train positions by interpolating between stops.
 *
 * Since GTFS-realtime provides stop-level predictions, we interpolate
 * the train's position between the last departed stop and the next arrival.
 */
export async function calculateTrainPositions(
  feedEntities: FeedEntity[]
): Promise<TrainPosition[]> {
  const { dict: stops } = await loadStops();
  const now = Date.now();
  const positions: TrainPosition[] = [];

  for (const entity of feedEntities) {
    const { routeId, tripId, stopUpdates } = entity;

    if (!routeId || !tripId || !stopUpdates || stopUpdates.length < 2) {
      continue;
    }

    // Find the two stops the train is between
    let prevStop: (typeof stopUpdates)[0] | null = null;
    let nextStop: (typeof stopUpdates)[0] | null = null;

    for (let i = 0; i < stopUpdates.length; i++) {
      const stop = stopUpdates[i];
      const arrivalTime = stop.arrival?.time
        ? new Date(stop.arrival.time).getTime()
        : null;

      if (arrivalTime && arrivalTime > now) {
        nextStop = stop;
        prevStop = stopUpdates[i - 1] || null;
        break;
      }
    }

    if (!prevStop || !nextStop || !prevStop.stopId || !nextStop.stopId) {
      continue;
    }

    const prevStopData = stops[prevStop.stopId];
    const nextStopData = stops[nextStop.stopId];

    if (!prevStopData || !nextStopData) {
      continue;
    }

    // Calculate progress between stops
    const prevTime = prevStop.departure?.time || prevStop.arrival?.time;
    const nextTime = nextStop.arrival?.time;

    if (!prevTime || !nextTime) {
      continue;
    }

    const prevTimeMs = new Date(prevTime).getTime();
    const nextTimeMs = new Date(nextTime).getTime();
    const totalDuration = nextTimeMs - prevTimeMs;

    if (totalDuration <= 0) {
      continue;
    }

    const elapsed = now - prevTimeMs;
    const progress = Math.max(0, Math.min(1, elapsed / totalDuration));

    // Interpolate position
    const lat =
      prevStopData.lat + (nextStopData.lat - prevStopData.lat) * progress;
    const lon =
      prevStopData.lon + (nextStopData.lon - prevStopData.lon) * progress;

    // Calculate heading (degrees from north)
    const heading = calculateHeading(
      prevStopData.lat,
      prevStopData.lon,
      nextStopData.lat,
      nextStopData.lon
    );

    // Get headsign from trips data with shape-based fallback
    const rawHeadsign = await getTripHeadsignWithFallback(tripId, routeId);

    // Validate headsign against actual direction of next stop
    // This fixes the bug where trip database direction doesn't match real-time stop
    const headsign = validateHeadsign(rawHeadsign, nextStop.stopId, routeId);

    positions.push({
      tripId,
      routeId,
      lat,
      lon,
      heading,
      nextStopId: nextStop.stopId,
      nextStopName: nextStopData.name,
      eta: nextTime,
      headsign,
      // New fields for client-side motion planning
      prevStopId: prevStop.stopId,
      prevTimeMs,
      nextTimeMs,
    });
  }

  return positions;
}

/**
 * Calculate heading in degrees from north (0-360).
 */
function calculateHeading(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let heading = (Math.atan2(y, x) * 180) / Math.PI;
  heading = (heading + 360) % 360;

  return heading;
}

/**
 * Filter train positions by route.
 */
export function filterTrainsByRoute(
  positions: TrainPosition[],
  routeId: string
): TrainPosition[] {
  const upperRoute = routeId.toUpperCase();
  return positions.filter((p) => p.routeId.toUpperCase() === upperRoute);
}

/**
 * Get trains near a specific station.
 */
export function getTrainsNearStation(
  positions: TrainPosition[],
  stationId: string
): TrainPosition[] {
  return positions.filter((p) => p.nextStopId === stationId);
}
