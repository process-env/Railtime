/**
 * Track Index - Loads and precomputes track geometry data for train animation
 *
 * This module provides:
 * - Route polylines from GeoJSON
 * - Cumulative distances along each track
 * - Stop arclength mapping (stop_id -> meters from route start)
 */

import type { Feature, MultiLineString } from 'geojson';
import { haversineDistance } from '@/lib/geo/nearest-stations';

// Re-export haversineDistance from the canonical geo location so existing
// consumers (arclength.ts, useTripRouteLayer.ts) that import from track-index
// continue to work without import changes.
export { haversineDistance } from '@/lib/geo/nearest-stations';

export interface RouteTrack {
  routeId: string;
  coords: [number, number][];       // [lng, lat] pairs (flattened from MultiLineString)
  cumDists: number[];               // Cumulative distance at each coord (meters)
  totalLength: number;              // Total track length (meters)
  stations: Map<string, number>;    // stop_id -> arclength (meters)
}

export interface TrackIndex {
  routes: Map<string, RouteTrack>;
  stops: Map<string, { lat: number; lon: number; name: string }>;
}

/**
 * Module-level mutable state for track index singleton.
 * Grouped into a single object to make it explicit that these are the only
 * mutable globals in this module and they are tightly coupled (loadingPromise
 * resolves to populate cache).
 */
interface TrackIndexState {
  /** Cached track index after successful load */
  cache: TrackIndex | null;
  /** In-flight loading promise to deduplicate concurrent requests */
  loadingPromise: Promise<TrackIndex> | null;
}

const trackState: TrackIndexState = {
  cache: null,
  loadingPromise: null,
};

/**
 * Compute cumulative distances for a coordinate array
 */
function computeCumulativeDistances(coords: [number, number][]): number[] {
  const cumDists: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dist = haversineDistance(lat1, lon1, lat2, lon2);
    cumDists.push(cumDists[i - 1] + dist);
  }
  return cumDists;
}

/**
 * Flatten MultiLineString coordinates into a single array
 * Chooses the longest segment as the "main" track
 */
function flattenMultiLineString(multiLine: number[][][]): [number, number][] {
  // Find the longest segment
  let longestIdx = 0;
  let maxLen = 0;
  for (let i = 0; i < multiLine.length; i++) {
    if (multiLine[i].length > maxLen) {
      maxLen = multiLine[i].length;
      longestIdx = i;
    }
  }
  return multiLine[longestIdx] as [number, number][];
}

/**
 * Project a point onto the track and return its arclength
 */
function projectPointToTrack(
  lat: number, lon: number,
  coords: [number, number][],
  cumDists: number[]
): number {
  let minDist = Infinity;
  let bestS = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    // Vector from p1 to p2
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    const segLenSq = dx * dx + dy * dy;

    if (segLenSq === 0) continue;

    // Project point onto segment
    const t = Math.max(0, Math.min(1,
      ((lon - lon1) * dx + (lat - lat1) * dy) / segLenSq
    ));

    // Closest point on segment
    const closeLon = lon1 + t * dx;
    const closeLat = lat1 + t * dy;

    const dist = haversineDistance(lat, lon, closeLat, closeLon);
    if (dist < minDist) {
      minDist = dist;
      // Arclength = cumulative distance to segment start + fraction along segment
      const segLen = cumDists[i + 1] - cumDists[i];
      bestS = cumDists[i] + t * segLen;
    }
  }

  return bestS;
}

/**
 * Parse a CSV line respecting quoted fields.
 * Handles escaped quotes ("") within quoted fields per RFC 4180.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse stops.txt CSV data
 */
function parseStops(csvText: string): Map<string, { lat: number; lon: number; name: string }> {
  const stops = new Map<string, { lat: number; lon: number; name: string }>();
  const lines = csvText.trim().split('\n');

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    if (parts.length >= 4) {
      const stopId = parts[0].trim();
      const name = parts[1].trim();
      const lat = parseFloat(parts[2]);
      const lon = parseFloat(parts[3]);
      if (!isNaN(lat) && !isNaN(lon)) {
        stops.set(stopId, { lat, lon, name });
      }
    }
  }

  return stops;
}

/**
 * Map which routes serve which parent stations
 * This is based on MTA route patterns
 */
const ROUTE_STOP_PREFIXES: Record<string, string[]> = {
  '1': ['1'],
  '2': ['1', '2'],
  '3': ['1', '2', '3'],
  '4': ['4'],
  '5': ['4', '5'],
  '6': ['6'],
  '7': ['7'],
  'A': ['A'],
  'B': ['D', 'B'],
  'C': ['A', 'C'],
  'D': ['D'],
  'E': ['E'],
  'F': ['F'],
  'FS': ['FS'],
  'G': ['G'],
  'GS': ['GS'],
  'H': ['H'],
  'J': ['J', 'M'],
  'L': ['L'],
  'M': ['M'],
  'N': ['N', 'Q', 'R'],
  'Q': ['Q'],
  'R': ['R'],
  'SI': ['S'],
};

/**
 * Load and build the track index
 */
async function buildTrackIndex(): Promise<TrackIndex> {
  // Load GeoJSON and stops in parallel
  const [geoResponse, stopsResponse] = await Promise.all([
    fetch('/map/nyc-subway-lines.geojson'),
    fetch('/data/stops.txt')
  ]);

  if (!geoResponse.ok) {
    throw new Error(`Failed to load GeoJSON: ${geoResponse.status}`);
  }
  if (!stopsResponse.ok) {
    throw new Error(`Failed to load stops: ${stopsResponse.status}`);
  }

  const geoJson = await geoResponse.json();
  const stopsText = await stopsResponse.text();

  const stops = parseStops(stopsText);
  const routes = new Map<string, RouteTrack>();

  // Process each route feature
  for (const feature of geoJson.features as Feature<MultiLineString>[]) {
    const routeId = feature.properties?.route_id as string;
    if (!routeId || feature.geometry.type !== 'MultiLineString') continue;

    const coords = flattenMultiLineString(feature.geometry.coordinates);
    const cumDists = computeCumulativeDistances(coords);
    const totalLength = cumDists[cumDists.length - 1];

    // Map stops to this route
    const stations = new Map<string, number>();

    // Find all stops that could belong to this route
    for (const [stopId, stopData] of stops) {
      // Get base stop ID (without N/S suffix)
      const baseId = stopId.replace(/[NS]$/, '');

      // Check if this stop could serve this route based on prefix patterns
      // MTA stop IDs typically start with a number for numbered lines or letter for lettered lines
      const _firstChar = baseId.charAt(0);
      const _routePrefixes = ROUTE_STOP_PREFIXES[routeId] || [];

      // For now, project all stops and keep those within reasonable distance
      const arclength = projectPointToTrack(
        stopData.lat, stopData.lon,
        coords, cumDists
      );

      // Verify the stop is actually close to the track
      const projectedPoint = arclengthToCoord(arclength, coords, cumDists);
      if (projectedPoint) {
        const [projLon, projLat] = projectedPoint;
        const dist = haversineDistance(stopData.lat, stopData.lon, projLat, projLon);

        // Only include stops within 500m of the track
        if (dist < 500) {
          stations.set(stopId, arclength);
        }
      }
    }

    routes.set(routeId, {
      routeId,
      coords,
      cumDists,
      totalLength,
      stations
    });
  }

  return { routes, stops };
}

/**
 * Convert arclength back to [lon, lat] coordinate
 */
function arclengthToCoord(
  s: number,
  coords: [number, number][],
  cumDists: number[]
): [number, number] | null {
  if (coords.length === 0) return null;

  // Clamp s to valid range
  s = Math.max(0, Math.min(s, cumDists[cumDists.length - 1]));

  // Binary search for the segment
  let lo = 0;
  let hi = cumDists.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cumDists[mid] <= s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Interpolate within segment
  const segStart = cumDists[lo];
  const segEnd = cumDists[lo + 1];
  const segLen = segEnd - segStart;

  if (segLen === 0) {
    return coords[lo];
  }

  const t = (s - segStart) / segLen;
  const [lon1, lat1] = coords[lo];
  const [lon2, lat2] = coords[lo + 1];

  return [
    lon1 + t * (lon2 - lon1),
    lat1 + t * (lat2 - lat1)
  ];
}

/**
 * Get the track index (loads lazily on first call)
 */
export async function getTrackIndex(): Promise<TrackIndex> {
  if (trackState.cache) {
    return trackState.cache;
  }

  if (!trackState.loadingPromise) {
    trackState.loadingPromise = buildTrackIndex().then(index => {
      trackState.cache = index;
      return index;
    });
  }

  return trackState.loadingPromise;
}

/**
 * Get a specific route's track data
 */
export async function getRouteTrack(routeId: string): Promise<RouteTrack | undefined> {
  const index = await getTrackIndex();
  return index.routes.get(routeId.toUpperCase());
}

/**
 * Get the arclength of a stop on a route
 */
export async function getStopArclength(
  routeId: string,
  stopId: string
): Promise<number | undefined> {
  const track = await getRouteTrack(routeId);
  if (!track) return undefined;

  // Try exact match first
  let s = track.stations.get(stopId);
  if (s !== undefined) return s;

  // Try without N/S suffix
  const baseId = stopId.replace(/[NS]$/, '');
  s = track.stations.get(baseId);
  if (s !== undefined) return s;

  // Try with N suffix
  s = track.stations.get(baseId + 'N');
  if (s !== undefined) return s;

  // Try with S suffix
  s = track.stations.get(baseId + 'S');
  return s;
}

/**
 * Find all stops between two arclength values on a route
 */
export async function findStopsBetween(
  routeId: string,
  sFrom: number,
  sTo: number
): Promise<Array<{ stopId: string; arclength: number }>> {
  const track = await getRouteTrack(routeId);
  if (!track) return [];

  const minS = Math.min(sFrom, sTo);
  const maxS = Math.max(sFrom, sTo);
  const result: Array<{ stopId: string; arclength: number }> = [];

  for (const [stopId, arclength] of track.stations) {
    if (arclength > minS && arclength < maxS) {
      result.push({ stopId, arclength });
    }
  }

  // Sort by arclength
  result.sort((a, b) => a.arclength - b.arclength);

  // Reverse if going backwards
  if (sFrom > sTo) {
    result.reverse();
  }

  return result;
}

/**
 * Get stop info from the index
 */
export async function getStopInfo(
  stopId: string
): Promise<{ lat: number; lon: number; name: string } | undefined> {
  const index = await getTrackIndex();
  return index.stops.get(stopId);
}
