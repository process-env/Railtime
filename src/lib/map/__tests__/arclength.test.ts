/**
 * Deterministic unit tests for arclength.ts
 *
 * Tests arclength conversion utilities using a synthetic 3-point L-shaped track.
 * No real data files are loaded.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  projectToTrack,
  arclengthToLatLon,
  interpolateHeading,
  getSegmentIndex,
  arclengthDistance,
  isMovingForward,
  clampArclength,
} from '../arclength';
import { haversineDistance } from '@/lib/geo/nearest-stations';
import type { RouteTrack } from '../track-index';

// ---------------------------------------------------------------------------
// Build a synthetic test track
// ---------------------------------------------------------------------------

/**
 * L-shaped track with 3 points:
 *   P0: (-74.0, 40.70)  -- start
 *   P1: (-74.0, 40.71)  -- corner (straight north)
 *   P2: (-73.99, 40.71) -- end (straight east)
 *
 * Segment 0 (P0->P1): ~1.11 km going north
 * Segment 1 (P1->P2): ~0.85 km going east (shorter due to longitude scaling)
 */
function buildTestTrack(): RouteTrack {
  const coords: [number, number][] = [
    [-74.0, 40.7],   // [lon, lat]
    [-74.0, 40.71],
    [-73.99, 40.71],
  ];

  // Compute cumulative distances
  const cumDists: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dist = haversineDistance(lat1, lon1, lat2, lon2);
    cumDists.push(cumDists[i - 1] + dist);
  }

  const totalLength = cumDists[cumDists.length - 1];

  return {
    routeId: 'TEST',
    coords,
    cumDists,
    totalLength,
    stations: new Map(),
  };
}

let track: RouteTrack;

// Build once before all tests
beforeAll(() => {
  track = buildTestTrack();
});

// ---------------------------------------------------------------------------
// projectToTrack
// ---------------------------------------------------------------------------

describe('projectToTrack', () => {
  it('projects a point on the first segment to correct arclength', () => {
    // Point at midpoint of first segment (straight north)
    const midLat = 40.705;
    const midLon = -74.0;
    const result = projectToTrack(midLat, midLon, track);

    // Should be approximately half of segment 0 length
    const seg0Length = track.cumDists[1];
    expect(result.arclength).toBeCloseTo(seg0Length / 2, -1); // within 10m
    expect(result.distance).toBeLessThan(10); // very close to track
    expect(result.segmentIndex).toBe(0);
  });

  it('projects a point on the second segment correctly', () => {
    // Point at midpoint of second segment (straight east at lat 40.71)
    const result = projectToTrack(40.71, -73.995, track);

    // Should be past the first segment
    expect(result.arclength).toBeGreaterThan(track.cumDists[1]);
    expect(result.segmentIndex).toBe(1);
    expect(result.distance).toBeLessThan(10);
  });

  it('projects a point off the track with non-zero distance', () => {
    // Point 0.005 degrees west of the track (~400m at NYC latitude)
    const result = projectToTrack(40.705, -74.005, track);

    expect(result.distance).toBeGreaterThan(100);
    expect(result.segmentIndex).toBe(0);
  });

  it('projects the start point to arclength ~0', () => {
    const result = projectToTrack(40.7, -74.0, track);
    expect(result.arclength).toBeCloseTo(0, 0);
    expect(result.distance).toBeLessThan(1);
  });

  it('projects the end point to arclength ~totalLength', () => {
    const result = projectToTrack(40.71, -73.99, track);
    expect(result.arclength).toBeCloseTo(track.totalLength, 0);
    expect(result.distance).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// arclengthToLatLon
// ---------------------------------------------------------------------------

describe('arclengthToLatLon', () => {
  it('returns first coord (as [lat, lon]) at s=0', () => {
    const [lat, lon] = arclengthToLatLon(0, track);
    expect(lat).toBeCloseTo(40.7, 4);
    expect(lon).toBeCloseTo(-74.0, 4);
  });

  it('returns last coord at s=totalLength', () => {
    const [lat, lon] = arclengthToLatLon(track.totalLength, track);
    expect(lat).toBeCloseTo(40.71, 4);
    expect(lon).toBeCloseTo(-73.99, 4);
  });

  it('interpolates at the corner point', () => {
    // s = cumDists[1] should be the corner at (-74.0, 40.71)
    const [lat, lon] = arclengthToLatLon(track.cumDists[1], track);
    expect(lat).toBeCloseTo(40.71, 4);
    expect(lon).toBeCloseTo(-74.0, 4);
  });

  it('returns [0, 0] for empty coords track', () => {
    const emptyTrack: RouteTrack = {
      routeId: 'EMPTY',
      coords: [],
      cumDists: [],
      totalLength: 0,
      stations: new Map(),
    };
    const [lat, lon] = arclengthToLatLon(100, emptyTrack);
    expect(lat).toBe(0);
    expect(lon).toBe(0);
  });

  it('clamps negative arclength to 0', () => {
    const [lat, lon] = arclengthToLatLon(-100, track);
    expect(lat).toBeCloseTo(40.7, 4);
    expect(lon).toBeCloseTo(-74.0, 4);
  });

  it('clamps arclength beyond totalLength to end', () => {
    const [lat, lon] = arclengthToLatLon(track.totalLength + 1000, track);
    expect(lat).toBeCloseTo(40.71, 4);
    expect(lon).toBeCloseTo(-73.99, 4);
  });

  it('round-trip: project then convert back is close to original', () => {
    // Take a known point on the track
    const originalLat = 40.705;
    const originalLon = -74.0;

    const projection = projectToTrack(originalLat, originalLon, track);
    const [recoveredLat, recoveredLon] = arclengthToLatLon(
      projection.arclength,
      track
    );

    // Should be within ~10m of original (point is on the track)
    const dist = haversineDistance(
      originalLat,
      originalLon,
      recoveredLat,
      recoveredLon
    );
    expect(dist).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// interpolateHeading
// ---------------------------------------------------------------------------

describe('interpolateHeading', () => {
  it('returns ~0 (north) for the first segment', () => {
    // First segment goes straight north
    const heading = interpolateHeading(track.cumDists[1] / 2, track);
    // North is 0 degrees; expect close to 0 (or 360)
    expect(heading % 360).toBeLessThan(5); // within 5 degrees of north
  });

  it('returns ~90 (east) for the second segment', () => {
    // Second segment goes east
    const midS =
      track.cumDists[1] + (track.cumDists[2] - track.cumDists[1]) / 2;
    const heading = interpolateHeading(midS, track);
    expect(heading).toBeCloseTo(90, -1); // within 10 degrees of east
  });

  it('returns 0 for a track with fewer than 2 points', () => {
    const tinyTrack: RouteTrack = {
      routeId: 'TINY',
      coords: [[-74.0, 40.7]],
      cumDists: [0],
      totalLength: 0,
      stations: new Map(),
    };
    expect(interpolateHeading(0, tinyTrack)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSegmentIndex
// ---------------------------------------------------------------------------

describe('getSegmentIndex', () => {
  it('returns 0 for s=0', () => {
    expect(getSegmentIndex(0, track)).toBe(0);
  });

  it('returns 0 for s in first segment', () => {
    expect(getSegmentIndex(track.cumDists[1] / 2, track)).toBe(0);
  });

  it('returns 1 for s in second segment', () => {
    const s = track.cumDists[1] + 10;
    expect(getSegmentIndex(s, track)).toBe(1);
  });

  it('clamps negative s to segment 0', () => {
    expect(getSegmentIndex(-100, track)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// arclengthDistance
// ---------------------------------------------------------------------------

describe('arclengthDistance', () => {
  it('returns positive for forward motion', () => {
    expect(arclengthDistance(100, 500)).toBe(400);
  });

  it('returns negative for backward motion', () => {
    expect(arclengthDistance(500, 100)).toBe(-400);
  });

  it('returns 0 for same position', () => {
    expect(arclengthDistance(300, 300)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isMovingForward
// ---------------------------------------------------------------------------

describe('isMovingForward', () => {
  it('returns true when sNext > sPrev', () => {
    expect(isMovingForward(100, 200)).toBe(true);
  });

  it('returns false when sNext < sPrev', () => {
    expect(isMovingForward(200, 100)).toBe(false);
  });

  it('returns false when sNext === sPrev', () => {
    expect(isMovingForward(100, 100)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clampArclength
// ---------------------------------------------------------------------------

describe('clampArclength', () => {
  it('clamps negative value to 0', () => {
    expect(clampArclength(-50, track)).toBe(0);
  });

  it('clamps value beyond totalLength', () => {
    expect(clampArclength(track.totalLength + 100, track)).toBe(
      track.totalLength
    );
  });

  it('returns value unchanged when in range', () => {
    const mid = track.totalLength / 2;
    expect(clampArclength(mid, track)).toBe(mid);
  });
});
