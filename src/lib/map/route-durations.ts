/**
 * Route Duration Matrix
 *
 * Loads pre-computed travel times from duration-matrix.json
 * The matrix is built at build time from GTFS stop_times.txt
 * See: scripts/build-duration-matrix.ts
 */

// routeId → fromStopId → toStopId → durationSeconds
export type RouteDurationMatrix = Map<string, Map<string, Map<string, number>>>;

// Pre-computed matrix format: { routeId: [[fromStop, toStop, seconds], ...] }
type PrecomputedMatrix = Record<string, Array<[string, string, number]>>;

let matrixCache: RouteDurationMatrix | null = null;
let matrixPromise: Promise<RouteDurationMatrix> | null = null;

/**
 * Load the pre-computed duration matrix
 * This is much faster than parsing GTFS at runtime (~5MB JSON vs 35MB parsing)
 */
export async function buildRouteDurationMatrix(): Promise<RouteDurationMatrix> {
  if (matrixCache) return matrixCache;
  if (matrixPromise) return matrixPromise;

  matrixPromise = (async () => {
    try {
      const response = await fetch('/data/duration-matrix.json');
      if (!response.ok) {
        console.warn('[route-durations] Failed to load pre-computed matrix, using empty');
        matrixCache = new Map();
        return matrixCache;
      }

      const data: PrecomputedMatrix = await response.json();

      // Convert from compact array format to nested Map structure
      const matrix: RouteDurationMatrix = new Map();

      for (const [routeId, segments] of Object.entries(data)) {
        const routeMap = new Map<string, Map<string, number>>();
        matrix.set(routeId, routeMap);

        for (const [fromStop, toStop, duration] of segments) {
          if (!routeMap.has(fromStop)) {
            routeMap.set(fromStop, new Map());
          }
          routeMap.get(fromStop)!.set(toStop, duration);
        }
      }

      matrixCache = matrix;
      console.log(`[route-durations] Loaded pre-computed matrix for ${matrix.size} routes`);
      return matrix;
    } catch (err) {
      console.error('[route-durations] Error loading matrix:', err);
      matrixCache = new Map();
      return matrixCache;
    }
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
