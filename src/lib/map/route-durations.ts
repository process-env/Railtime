/**
 * Route Duration Matrix
 * Pre-computes travel time between consecutive stops from GTFS stop_times.txt
 */

// routeId → fromStopId → toStopId → durationSeconds
export type RouteDurationMatrix = Map<string, Map<string, Map<string, number>>>;

let matrixCache: RouteDurationMatrix | null = null;
let matrixPromise: Promise<RouteDurationMatrix> | null = null;

/**
 * Parse time string "HH:MM:SS" to seconds from midnight
 */
function parseTimeToSeconds(timeStr: string): number {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Build the route duration matrix from GTFS data
 */
export async function buildRouteDurationMatrix(): Promise<RouteDurationMatrix> {
  if (matrixCache) return matrixCache;
  if (matrixPromise) return matrixPromise;

  matrixPromise = (async () => {
    // Fetch both files
    const [tripsRes, stopTimesRes] = await Promise.all([
      fetch('/data/trips.txt'),
      fetch('/data/stop_times.txt')
    ]);

    const tripsText = await tripsRes.text();
    const stopTimesText = await stopTimesRes.text();

    // Parse trips.txt → Map<tripId, routeId>
    // Format: route_id,service_id,trip_id,trip_headsign,direction_id,shape_id
    const tripToRoute = new Map<string, string>();
    const tripLines = tripsText.split('\n').slice(1); // Skip header
    for (const line of tripLines) {
      if (!line.trim()) continue;
      const parts = line.split(',');
      const routeId = parts[0]?.trim();
      const tripId = parts[2]?.trim();
      if (routeId && tripId) {
        tripToRoute.set(tripId, routeId);
      }
    }

    // Parse stop_times.txt and group by trip
    // Format: trip_id,arrival_time,departure_time,stop_id,stop_sequence
    const tripStops = new Map<string, Array<{ stopId: string; arrivalSec: number; seq: number }>>();
    const stopTimesLines = stopTimesText.split('\n').slice(1);
    for (const line of stopTimesLines) {
      if (!line.trim()) continue;
      const parts = line.split(',');
      const tripId = parts[0]?.trim();
      const arrivalTime = parts[1]?.trim();
      const stopId = parts[3]?.trim();
      const seq = parseInt(parts[4]?.trim() || '0', 10);

      if (!tripId || !stopId || !arrivalTime) continue;

      const arrivalSec = parseTimeToSeconds(arrivalTime);
      if (!tripStops.has(tripId)) {
        tripStops.set(tripId, []);
      }
      tripStops.get(tripId)!.push({ stopId, arrivalSec, seq });
    }

    // Build matrix: for each trip, calculate duration between consecutive stops
    // Then aggregate by route (average)
    const routeDurations: Map<string, Map<string, Map<string, number[]>>> = new Map();

    for (const [tripId, stops] of tripStops) {
      const routeId = tripToRoute.get(tripId);
      if (!routeId) continue;

      // Sort by sequence
      stops.sort((a, b) => a.seq - b.seq);

      // Calculate durations between consecutive stops
      for (let i = 0; i < stops.length - 1; i++) {
        const from = stops[i];
        const to = stops[i + 1];
        let duration = to.arrivalSec - from.arrivalSec;

        // Handle overnight trips (arrival < departure)
        if (duration < 0) duration += 86400;

        // Skip invalid durations
        if (duration <= 0 || duration > 1800) continue; // Max 30 min between stops

        if (!routeDurations.has(routeId)) {
          routeDurations.set(routeId, new Map());
        }
        const fromMap = routeDurations.get(routeId)!;
        if (!fromMap.has(from.stopId)) {
          fromMap.set(from.stopId, new Map());
        }
        const toMap = fromMap.get(from.stopId)!;
        if (!toMap.has(to.stopId)) {
          toMap.set(to.stopId, []);
        }
        toMap.get(to.stopId)!.push(duration);
      }
    }

    // Average the durations
    const matrix: RouteDurationMatrix = new Map();
    for (const [routeId, fromMap] of routeDurations) {
      matrix.set(routeId, new Map());
      const routeMatrix = matrix.get(routeId)!;
      for (const [fromStop, toMap] of fromMap) {
        routeMatrix.set(fromStop, new Map());
        const fromMatrix = routeMatrix.get(fromStop)!;
        for (const [toStop, durations] of toMap) {
          const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
          fromMatrix.set(toStop, Math.round(avg));
        }
      }
    }

    matrixCache = matrix;
    console.log(`[route-durations] Built matrix for ${matrix.size} routes`);
    return matrix;
  })();

  return matrixPromise;
}

/**
 * Get duration between two stops for a route
 * Returns seconds, or undefined if not found
 */
export function getSegmentDuration(
  matrix: RouteDurationMatrix,
  routeId: string,
  fromStopId: string,
  toStopId: string
): number | undefined {
  // Try exact match
  const duration = matrix.get(routeId)?.get(fromStopId)?.get(toStopId);
  if (duration !== undefined) return duration;

  // Try without direction suffix (N/S)
  const fromBase = fromStopId.replace(/[NS]$/, '');
  const toBase = toStopId.replace(/[NS]$/, '');

  // Try all combinations
  for (const from of [fromStopId, fromBase + 'N', fromBase + 'S', fromBase]) {
    for (const to of [toStopId, toBase + 'N', toBase + 'S', toBase]) {
      const d = matrix.get(routeId)?.get(from)?.get(to);
      if (d !== undefined) return d;
    }
  }

  return undefined;
}

/**
 * Get the matrix (loading it if necessary)
 */
export async function getRouteDurationMatrix(): Promise<RouteDurationMatrix> {
  return buildRouteDurationMatrix();
}
