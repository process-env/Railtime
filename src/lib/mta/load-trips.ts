import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const TRIPS_CSV = path.join(DATA_DIR, 'trips.txt');

interface TripInfo {
  routeId: string;
  headsign: string;
  directionId: string;
}

// Cache: Map<tripId, TripInfo>
// Stores both full trip IDs and suffix-based lookups
let tripsCache: Map<string, TripInfo> | null = null;

// Secondary index: Map<"routeId:shapeId", headsign>
// Used for fallback when exact trip ID match fails
let shapeIndex: Map<string, string> | null = null;

// Tertiary index: Map<"routeId:N" or "routeId:S", headsign>
// Used for direction-only fallback when shape doesn't match (e.g., 7 train)
let directionIndex: Map<string, string> | null = null;

/**
 * Extract the suffix from a full trip ID.
 * Full format: "BFA25GEN-M093-Weekday-00_113950_M..N20R"
 * GTFS-RT format: "113950_M..N20R"
 *
 * The suffix is the part after "-00_" which matches what GTFS-RT returns.
 */
function extractTripSuffix(fullTripId: string): string | null {
  const match = fullTripId.match(/-00_(.+)$/);
  return match ? match[1] : null;
}

/**
 * Extract shape_id from a GTFS-RT trip ID suffix.
 * Input: "114450_N..N31R" -> Output: "N..N31R"
 * Input: "031700_1..S03R" -> Output: "1..S03R"
 * Input: "119650_7..N" -> Output: "7..N" (truncated format from some feeds)
 *
 * The shape pattern is the part after the last underscore,
 * matching format: letter(s)..[N|S]variant (e.g., N..N31R, 1..S03R, 7..N)
 */
function extractShapeFromTripId(tripId: string): string | null {
  // Match shapes with or without variant suffix (e.g., N..N31R or 7..N)
  const match = tripId.match(/_([A-Z0-9]+\.\.[NS][A-Z0-9]*)$/i);
  return match ? match[1] : null;
}

/**
 * Extract direction (N or S) from a shape pattern.
 * Input: "7..N" -> "N"
 * Input: "N..S31R" -> "S"
 */
function extractDirectionFromShape(shape: string): string | null {
  const match = shape.match(/\.\.([NS])/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Load trips.txt and build lookup cache
 */
export async function loadTrips(): Promise<Map<string, TripInfo>> {
  if (tripsCache) return tripsCache;

  console.log('Loading trips data from trips.txt...');
  const startTime = Date.now();

  const text = await fs.readFile(TRIPS_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // Build lookup: tripId -> TripInfo
  // Index by both full trip ID and suffix for GTFS-RT compatibility
  tripsCache = new Map();
  shapeIndex = new Map();
  directionIndex = new Map();

  for (const r of rows) {
    const info: TripInfo = {
      routeId: r.route_id,
      headsign: r.trip_headsign,
      directionId: r.direction_id,
    };

    // Store by full trip ID
    tripsCache.set(r.trip_id, info);

    // Also store by suffix (what GTFS-RT uses)
    const suffix = extractTripSuffix(r.trip_id);
    if (suffix) {
      tripsCache.set(suffix, info);
    }

    // Build shape and direction indexes for fallback lookups
    if (r.route_id && r.trip_headsign) {
      const shape = r.shape_id || extractShapeFromTripId(r.trip_id);
      if (shape) {
        // Full shape index: "routeId:shapeId" -> headsign
        const shapeKey = `${r.route_id}:${shape}`;
        if (!shapeIndex.has(shapeKey)) {
          shapeIndex.set(shapeKey, r.trip_headsign);
        }

        // Direction-only index: "routeId:N" or "routeId:S" -> headsign
        const dir = extractDirectionFromShape(shape);
        if (dir) {
          const dirKey = `${r.route_id}:${dir}`;
          if (!directionIndex.has(dirKey)) {
            directionIndex.set(dirKey, r.trip_headsign);
          }
        }
      }
    }
  }

  console.log(`Trips loaded in ${Date.now() - startTime}ms (${rows.length} trips, ${tripsCache.size} primary, ${shapeIndex.size} shape, ${directionIndex.size} direction entries)`);
  return tripsCache;
}

/**
 * Get trip headsign by trip ID
 * Returns null if no trip found
 */
export async function getTripHeadsign(tripId: string): Promise<string | null> {
  const trips = await loadTrips();
  const trip = trips.get(tripId);
  return trip?.headsign ?? null;
}

/**
 * Get trip headsign with shape-based fallback.
 *
 * Lookup strategy:
 * 1. Exact/suffix match on tripId
 * 2. If not found, extract shape from tripId and look up by routeId:shapeId
 * 3. If still not found, try direction-only lookup by routeId:N or routeId:S
 *
 * @param tripId - The GTFS-RT trip ID (e.g., "114450_N..N31R" or "119650_7..N")
 * @param routeId - The route ID for fallback lookup (e.g., "N", "7")
 * @returns The headsign or null if not found
 */
export async function getTripHeadsignWithFallback(
  tripId: string,
  routeId: string
): Promise<string | null> {
  const trips = await loadTrips();

  // Strategy 1: Direct lookup (exact or suffix match)
  const trip = trips.get(tripId);
  if (trip?.headsign) {
    return trip.headsign;
  }

  const shape = extractShapeFromTripId(tripId);
  if (!shape || !routeId) {
    return null;
  }

  // Strategy 2: Shape-based fallback
  if (shapeIndex) {
    const shapeKey = `${routeId}:${shape}`;
    const headsign = shapeIndex.get(shapeKey);
    if (headsign) {
      return headsign;
    }
  }

  // Strategy 3: Direction-only fallback (for truncated trip IDs like 7..N)
  if (directionIndex) {
    const dir = extractDirectionFromShape(shape);
    if (dir) {
      const dirKey = `${routeId}:${dir}`;
      const headsign = directionIndex.get(dirKey);
      if (headsign) {
        return headsign;
      }
    }
  }

  return null;
}

/**
 * Get trip info by trip ID
 */
export async function getTripInfo(tripId: string): Promise<TripInfo | null> {
  const trips = await loadTrips();
  return trips.get(tripId) ?? null;
}

/**
 * Clear cache (for testing)
 */
export function clearTripsCache(): void {
  tripsCache = null;
  shapeIndex = null;
  directionIndex = null;
}
