/**
 * Geospatial utilities for finding nearest stations
 */

/**
 * Earth's radius in meters
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the Haversine distance between two points in meters
 * Uses the spherical law of cosines for accuracy on Earth's surface
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

/**
 * Format distance for display (e.g., "0.2 mi" or "150 ft")
 */
export function formatDistance(meters: number): string {
  const miles = metersToMiles(meters);

  if (miles < 0.1) {
    // Show in feet for short distances
    const feet = Math.round(meters * 3.28084);
    return `${feet} ft`;
  }

  return `${miles.toFixed(1)} mi`;
}

/**
 * Station with coordinates for distance calculation
 */
export interface StationWithCoords {
  id: string;
  name: string;
  lat: number;
  lon: number;
  enrichedName?: string;
}

/**
 * Station with distance information
 */
export interface NearbyStation extends StationWithCoords {
  distanceMeters: number;
  distanceFormatted: string;
}

/**
 * Find the nearest stations to a given location
 *
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param stations Dictionary of stations with coordinates
 * @param limit Maximum number of stations to return (default: 3)
 * @param maxDistanceMeters Maximum distance to search (default: 2000m = ~1.2 mi)
 * @returns Array of nearby stations sorted by distance
 */
export function findNearestStations(
  userLat: number,
  userLon: number,
  stations: Record<string, StationWithCoords>,
  limit: number = 3,
  maxDistanceMeters: number = 2000
): NearbyStation[] {
  const stationsWithDistance: NearbyStation[] = [];

  for (const station of Object.values(stations)) {
    // Skip stations without valid coordinates
    if (typeof station.lat !== 'number' || typeof station.lon !== 'number') {
      continue;
    }

    const distanceMeters = haversineDistance(
      userLat,
      userLon,
      station.lat,
      station.lon
    );

    // Only include stations within max distance
    if (distanceMeters <= maxDistanceMeters) {
      stationsWithDistance.push({
        ...station,
        distanceMeters,
        distanceFormatted: formatDistance(distanceMeters),
      });
    }
  }

  // Sort by distance and return top N
  return stationsWithDistance
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/**
 * Check if user is within walking distance of any station
 *
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param stations Dictionary of stations
 * @param walkingDistanceMeters Maximum walking distance (default: 500m = ~0.3 mi)
 * @returns Whether user is within walking distance of at least one station
 */
export function isNearStation(
  userLat: number,
  userLon: number,
  stations: Record<string, StationWithCoords>,
  walkingDistanceMeters: number = 500
): boolean {
  for (const station of Object.values(stations)) {
    if (typeof station.lat !== 'number' || typeof station.lon !== 'number') {
      continue;
    }

    const distance = haversineDistance(
      userLat,
      userLon,
      station.lat,
      station.lon
    );

    if (distance <= walkingDistanceMeters) {
      return true;
    }
  }

  return false;
}
