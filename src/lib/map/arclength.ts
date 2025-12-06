/**
 * Arclength Utilities - Convert between lat/lon and arclength along track
 *
 * This module provides:
 * - projectToTrack: Map-match a lat/lon point to arclength on a route
 * - arclengthToLatLon: Convert arclength back to lat/lon
 * - interpolateHeading: Calculate heading at a position
 */

import { haversineDistance, type RouteTrack } from './track-index';

export interface ProjectionResult {
  arclength: number;          // Distance from track start (meters)
  distance: number;           // Distance from point to track (meters)
  closestPoint: [number, number]; // [lon, lat] of closest point on track
  segmentIndex: number;       // Index of the track segment
}

/**
 * Project a lat/lon point onto a track and return its arclength
 *
 * Uses perpendicular projection to find the closest point on each segment,
 * then returns the arclength of that point.
 */
export function projectToTrack(
  lat: number,
  lon: number,
  track: RouteTrack
): ProjectionResult {
  const { coords, cumDists } = track;

  let minDist = Infinity;
  let bestResult: ProjectionResult = {
    arclength: 0,
    distance: Infinity,
    closestPoint: coords[0] || [0, 0],
    segmentIndex: 0
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    // Vector from p1 to p2
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    const segLenSq = dx * dx + dy * dy;

    let t = 0;
    if (segLenSq > 0) {
      // Project point onto segment parameter
      t = Math.max(0, Math.min(1,
        ((lon - lon1) * dx + (lat - lat1) * dy) / segLenSq
      ));
    }

    // Closest point on segment
    const closeLon = lon1 + t * dx;
    const closeLat = lat1 + t * dy;

    const dist = haversineDistance(lat, lon, closeLat, closeLon);
    if (dist < minDist) {
      minDist = dist;
      const segLen = cumDists[i + 1] - cumDists[i];
      bestResult = {
        arclength: cumDists[i] + t * segLen,
        distance: dist,
        closestPoint: [closeLon, closeLat],
        segmentIndex: i
      };
    }
  }

  return bestResult;
}

/**
 * Convert an arclength value to lat/lon coordinates on the track
 */
export function arclengthToLatLon(
  s: number,
  track: RouteTrack
): [number, number] {
  const { coords, cumDists, totalLength } = track;

  if (coords.length === 0) {
    return [0, 0];
  }

  // Clamp s to valid range
  s = Math.max(0, Math.min(s, totalLength));

  // Binary search for the segment containing s
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

  // Handle edge case at the end
  if (lo >= coords.length - 1) {
    return [coords[coords.length - 1][1], coords[coords.length - 1][0]];
  }

  // Interpolate within segment
  const segStart = cumDists[lo];
  const segEnd = cumDists[lo + 1];
  const segLen = segEnd - segStart;

  const t = segLen > 0 ? (s - segStart) / segLen : 0;

  const [lon1, lat1] = coords[lo];
  const [lon2, lat2] = coords[lo + 1];

  const lat = lat1 + t * (lat2 - lat1);
  const lon = lon1 + t * (lon2 - lon1);

  return [lat, lon];
}

/**
 * Calculate heading (degrees from north) at a given arclength
 */
export function interpolateHeading(
  s: number,
  track: RouteTrack
): number {
  const { coords, cumDists, totalLength } = track;

  if (coords.length < 2) return 0;

  // Clamp s to valid range
  s = Math.max(0, Math.min(s, totalLength));

  // Find the segment
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

  // Get segment endpoints
  const [lon1, lat1] = coords[lo];
  const [lon2, lat2] = coords[Math.min(lo + 1, coords.length - 1)];

  // Calculate heading using great circle bearing
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let heading = Math.atan2(y, x) * 180 / Math.PI;
  heading = (heading + 360) % 360;

  return heading;
}

/**
 * Calculate the segment index at a given arclength
 */
export function getSegmentIndex(
  s: number,
  track: RouteTrack
): number {
  const { cumDists, totalLength } = track;

  s = Math.max(0, Math.min(s, totalLength));

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

  return lo;
}

/**
 * Calculate distance between two arclength values
 * (accounts for direction)
 */
export function arclengthDistance(sFrom: number, sTo: number): number {
  return sTo - sFrom;
}

/**
 * Check if train is moving in positive direction (increasing arclength)
 */
export function isMovingForward(sPrev: number, sNext: number): boolean {
  return sNext > sPrev;
}

/**
 * Clamp arclength to track bounds
 */
export function clampArclength(s: number, track: RouteTrack): number {
  return Math.max(0, Math.min(s, track.totalLength));
}
