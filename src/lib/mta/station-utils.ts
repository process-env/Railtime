import type { Station, Stop } from '@/types/mta';

/**
 * Checks if a station/stop is a parent station (not a platform).
 * Parent stations have no parent field and their ID doesn't end with N/S (platform suffix).
 *
 * Examples:
 * - "101" -> true (parent station)
 * - "101N" -> false (northbound platform)
 * - "A41" -> true (parent station with alphanumeric ID)
 * - "A41S" -> false (southbound platform)
 */
export function isParentStation(station: Station | Stop): boolean {
  return !station.parent && !/[NS]$/.test(station.id);
}

/**
 * Extracts parent station ID from a stop ID by removing N/S platform suffix.
 * Returns null if the stopId is invalid.
 *
 * Examples:
 * - "101N" -> "101"
 * - "A41S" -> "A41"
 * - "101" -> "101" (already a parent ID)
 */
export function getParentStationId(stopId: string | null | undefined): string | null {
  if (!stopId || typeof stopId !== 'string') return null;
  return stopId.replace(/[NS]$/, '');
}

/**
 * Filters a list of stations to only include parent stations.
 */
export function filterParentStations<T extends Station | Stop>(stations: T[]): T[] {
  return stations.filter(isParentStation);
}

/**
 * Checks if a station serves a specific route.
 */
export function stationServesRoute(station: Station | Stop, routeId: string): boolean {
  if (!station.routes) return false;
  const stationRoutes = station.routes.split(/[,\s]+/).map((r) => r.toUpperCase());
  return stationRoutes.includes(routeId.toUpperCase());
}

/**
 * Checks if a station serves any of the specified routes.
 */
export function stationServesAnyRoute(station: Station | Stop, routeIds: string[]): boolean {
  if (!station.routes || routeIds.length === 0) return false;
  const stationRoutes = station.routes.split(/[,\s]+/).map((r) => r.toUpperCase());
  return routeIds.some((r) => stationRoutes.includes(r.toUpperCase()));
}
