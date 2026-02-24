/**
 * Deterministic unit tests for cluster-trains.ts
 *
 * Tests train clustering and offset calculation using synthetic positions.
 * CLUSTER_THRESHOLD_DEGREES = 0.0005 (~50m at NYC latitude)
 * MARKER_OFFSET_PX = 12
 */

import { describe, it, expect } from 'vitest';
import {
  clusterTrains,
  calculateTrainOffsets,
  isTrainClustered,
  type TrainWithPosition,
} from '../cluster-trains';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrain(
  tripId: string,
  routeId: string,
  lat: number,
  lon: number
): TrainWithPosition {
  return { tripId, routeId, lat, lon };
}

// Baseline position (roughly Times Square)
const BASE_LAT = 40.758;
const BASE_LON = -73.9855;

// A separation that is definitely beyond the clustering threshold
const FAR_OFFSET = 0.01; // ~1km, well beyond 0.0005 threshold

// A separation that is within clustering threshold
const NEAR_OFFSET = 0.0002; // well within 0.0005

// ---------------------------------------------------------------------------
// clusterTrains
// ---------------------------------------------------------------------------

describe('clusterTrains', () => {
  it('returns empty array for empty input', () => {
    expect(clusterTrains([])).toEqual([]);
  });

  it('returns one cluster for a single train', () => {
    const trains = [makeTrain('t1', 'N', BASE_LAT, BASE_LON)];
    const clusters = clusterTrains(trains);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].trains).toHaveLength(1);
    expect(clusters[0].trains[0].tripId).toBe('t1');
    expect(clusters[0].centerLat).toBeCloseTo(BASE_LAT, 5);
    expect(clusters[0].centerLon).toBeCloseTo(BASE_LON, 5);
  });

  it('returns two clusters for two trains far apart', () => {
    const trains = [
      makeTrain('t1', 'N', BASE_LAT, BASE_LON),
      makeTrain('t2', 'Q', BASE_LAT + FAR_OFFSET, BASE_LON + FAR_OFFSET),
    ];
    const clusters = clusterTrains(trains);

    expect(clusters).toHaveLength(2);
    expect(clusters[0].trains).toHaveLength(1);
    expect(clusters[1].trains).toHaveLength(1);
  });

  it('returns one cluster for two trains close together', () => {
    const trains = [
      makeTrain('t1', 'N', BASE_LAT, BASE_LON),
      makeTrain('t2', 'Q', BASE_LAT + NEAR_OFFSET, BASE_LON + NEAR_OFFSET),
    ];
    const clusters = clusterTrains(trains);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].trains).toHaveLength(2);
  });

  it('sorts trains within a cluster by routeId', () => {
    const trains = [
      makeTrain('t1', 'R', BASE_LAT, BASE_LON),
      makeTrain('t2', 'A', BASE_LAT + NEAR_OFFSET, BASE_LON),
      makeTrain('t3', 'N', BASE_LAT, BASE_LON + NEAR_OFFSET),
    ];
    const clusters = clusterTrains(trains);

    expect(clusters).toHaveLength(1);
    const routeIds = clusters[0].trains.map((t) => t.routeId);
    expect(routeIds).toEqual(['A', 'N', 'R']);
  });

  it('computes cluster center as average position', () => {
    const lat1 = BASE_LAT;
    const lon1 = BASE_LON;
    const lat2 = BASE_LAT + NEAR_OFFSET;
    const lon2 = BASE_LON + NEAR_OFFSET;

    const trains = [
      makeTrain('t1', 'N', lat1, lon1),
      makeTrain('t2', 'Q', lat2, lon2),
    ];
    const clusters = clusterTrains(trains);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].centerLat).toBeCloseTo((lat1 + lat2) / 2, 5);
    expect(clusters[0].centerLon).toBeCloseTo((lon1 + lon2) / 2, 5);
  });

  it('handles mixed: two close + one far = two clusters', () => {
    const trains = [
      makeTrain('t1', 'N', BASE_LAT, BASE_LON),
      makeTrain('t2', 'Q', BASE_LAT + NEAR_OFFSET, BASE_LON),
      makeTrain('t3', 'R', BASE_LAT + FAR_OFFSET, BASE_LON + FAR_OFFSET),
    ];
    const clusters = clusterTrains(trains);

    expect(clusters).toHaveLength(2);

    // Find the cluster with 2 trains
    const bigCluster = clusters.find((c) => c.trains.length === 2);
    const smallCluster = clusters.find((c) => c.trains.length === 1);

    expect(bigCluster).toBeDefined();
    expect(smallCluster).toBeDefined();
    expect(smallCluster!.trains[0].tripId).toBe('t3');
  });

  it('does not double-assign trains', () => {
    const trains = [
      makeTrain('t1', 'A', BASE_LAT, BASE_LON),
      makeTrain('t2', 'B', BASE_LAT + NEAR_OFFSET, BASE_LON),
      makeTrain('t3', 'C', BASE_LAT + NEAR_OFFSET * 2, BASE_LON),
    ];
    const clusters = clusterTrains(trains);

    // All trains should appear exactly once across all clusters
    const allTripIds = clusters.flatMap((c) => c.trains.map((t) => t.tripId));
    expect(allTripIds).toHaveLength(3);
    expect(new Set(allTripIds).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// calculateTrainOffsets
// ---------------------------------------------------------------------------

describe('calculateTrainOffsets', () => {
  it('returns empty map for empty input', () => {
    const offsets = calculateTrainOffsets([]);
    expect(offsets.size).toBe(0);
  });

  it('gives zero offset to a single train', () => {
    const trains = [makeTrain('t1', 'N', BASE_LAT, BASE_LON)];
    const offsets = calculateTrainOffsets(trains);

    const offset = offsets.get('t1');
    expect(offset).toBeDefined();
    expect(offset!.offsetX).toBe(0);
    expect(offset!.offsetY).toBe(0);
  });

  it('offsets clustered trains diagonally', () => {
    const trains = [
      makeTrain('t1', 'A', BASE_LAT, BASE_LON),
      makeTrain('t2', 'B', BASE_LAT + NEAR_OFFSET, BASE_LON),
    ];
    const offsets = calculateTrainOffsets(trains);

    // After sorting by routeId: A first, B second
    // First train (A) in cluster gets zero offset
    const offsetA = offsets.get('t1')!;
    expect(offsetA.offsetX).toBe(0);
    expect(offsetA.offsetY).toBe(0);

    // Second train (B) in cluster gets diagonal offset of 12px
    const offsetB = offsets.get('t2')!;
    expect(offsetB.offsetX).toBe(12);
    expect(offsetB.offsetY).toBe(-12);
  });

  it('gives zero offset to unclustered trains', () => {
    const trains = [
      makeTrain('t1', 'N', BASE_LAT, BASE_LON),
      makeTrain('t2', 'Q', BASE_LAT + FAR_OFFSET, BASE_LON + FAR_OFFSET),
    ];
    const offsets = calculateTrainOffsets(trains);

    expect(offsets.get('t1')!.offsetX).toBe(0);
    expect(offsets.get('t1')!.offsetY).toBe(0);
    expect(offsets.get('t2')!.offsetX).toBe(0);
    expect(offsets.get('t2')!.offsetY).toBe(0);
  });

  it('assigns correct zIndex: highest to first in cluster', () => {
    const trains = [
      makeTrain('t1', 'A', BASE_LAT, BASE_LON),
      makeTrain('t2', 'B', BASE_LAT + NEAR_OFFSET, BASE_LON),
      makeTrain('t3', 'C', BASE_LAT + NEAR_OFFSET, BASE_LON + NEAR_OFFSET),
    ];
    const offsets = calculateTrainOffsets(trains);

    // Cluster has 3 trains sorted by routeId: A, B, C
    // zIndex for first (A) = cluster.length = 3
    // zIndex for second (B) = 3 - 1 = 2
    // zIndex for third (C) = 3 - 2 = 1
    expect(offsets.get('t1')!.zIndex).toBe(3);
    expect(offsets.get('t2')!.zIndex).toBe(2);
    expect(offsets.get('t3')!.zIndex).toBe(1);
  });

  it('caps offset at MAX_OFFSET_LEVELS (5)', () => {
    // Create 7 trains at same location
    const trains: TrainWithPosition[] = [];
    for (let i = 0; i < 7; i++) {
      trains.push(
        makeTrain(`t${i}`, String.fromCharCode(65 + i), BASE_LAT, BASE_LON)
      );
    }
    const offsets = calculateTrainOffsets(trains);

    // Train at index 6 should be capped at level 5
    // Sorted by routeId: A(0), B(1), C(2), D(3), E(4), F(5), G(6)
    const offsetG = offsets.get('t6')!;
    expect(offsetG.offsetX).toBe(5 * 12); // capped at level 5
    expect(offsetG.offsetY).toBe(-5 * 12);
  });
});

// ---------------------------------------------------------------------------
// isTrainClustered
// ---------------------------------------------------------------------------

describe('isTrainClustered', () => {
  it('returns false for unclustered train', () => {
    const trains = [makeTrain('t1', 'N', BASE_LAT, BASE_LON)];
    const offsets = calculateTrainOffsets(trains);
    expect(isTrainClustered('t1', offsets)).toBe(false);
  });

  it('returns false for first train in cluster (zero offset)', () => {
    const trains = [
      makeTrain('t1', 'A', BASE_LAT, BASE_LON),
      makeTrain('t2', 'B', BASE_LAT + NEAR_OFFSET, BASE_LON),
    ];
    const offsets = calculateTrainOffsets(trains);
    // First in cluster (A) has zero offset
    expect(isTrainClustered('t1', offsets)).toBe(false);
  });

  it('returns true for non-first train in cluster (non-zero offset)', () => {
    const trains = [
      makeTrain('t1', 'A', BASE_LAT, BASE_LON),
      makeTrain('t2', 'B', BASE_LAT + NEAR_OFFSET, BASE_LON),
    ];
    const offsets = calculateTrainOffsets(trains);
    expect(isTrainClustered('t2', offsets)).toBe(true);
  });

  it('returns false for unknown tripId', () => {
    const trains = [makeTrain('t1', 'N', BASE_LAT, BASE_LON)];
    const offsets = calculateTrainOffsets(trains);
    expect(isTrainClustered('unknown', offsets)).toBe(false);
  });
});
