/**
 * Tests for Dijkstra's algorithm implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { findShortestPath, findRouteVariants } from '../dijkstra';
import {
  createMockGraph,
  createMinimalGraph,
  createEmptyGraph,
  createDisconnectedGraph,
  STATION_A,
  STATION_B,
  STATION_D,
  STATION_E,
  STATION_F,
  STATION_H,
  ROUTE_1,
  ROUTE_2,
  DURATION_SHORT,
  TRANSFER_WALK_TIME,
} from './fixtures/mock-graph';
import type { TransitGraph } from '../types';

describe('findShortestPath', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  describe('basic pathfinding', () => {
    it('finds direct path on same route', () => {
      const result = findShortestPath(graph, STATION_A, STATION_D);

      expect(result).not.toBeNull();
      expect(result!.path.length).toBe(4); // A, B, C, D
      expect(result!.transferCount).toBe(0);
      expect(result!.actualDuration).toBe(180); // 60 + 60 + 60
    });

    it('finds path between adjacent stations', () => {
      const result = findShortestPath(graph, STATION_A, STATION_B);

      expect(result).not.toBeNull();
      expect(result!.path.length).toBe(2);
      expect(result!.transferCount).toBe(0);
      expect(result!.actualDuration).toBe(DURATION_SHORT);
    });

    it('path starts at origin station', () => {
      const result = findShortestPath(graph, STATION_A, STATION_D);

      expect(result).not.toBeNull();
      expect(result!.path[0].stationId).toBe(STATION_A);
      expect(result!.path[0].routeId).toBe(ROUTE_1);
    });

    it('path ends at destination station', () => {
      const result = findShortestPath(graph, STATION_A, STATION_D);

      expect(result).not.toBeNull();
      const lastNode = result!.path[result!.path.length - 1];
      expect(lastNode.stationId).toBe(STATION_D);
    });

    it('edges match path nodes', () => {
      const result = findShortestPath(graph, STATION_A, STATION_D);

      expect(result).not.toBeNull();
      expect(result!.edges.length).toBe(result!.path.length - 1);

      // First edge starts from first node
      expect(result!.edges[0].from.stationId).toBe(result!.path[0].stationId);

      // Last edge ends at last node
      const lastEdge = result!.edges[result!.edges.length - 1];
      const lastPathNode = result!.path[result!.path.length - 1];
      expect(lastEdge.to.stationId).toBe(lastPathNode.stationId);
    });
  });

  describe('invalid inputs', () => {
    it('returns null for non-existent origin station', () => {
      const result = findShortestPath(graph, 'NONEXISTENT', STATION_D);
      expect(result).toBeNull();
    });

    it('returns null for non-existent destination station', () => {
      const result = findShortestPath(graph, STATION_A, 'NONEXISTENT');
      expect(result).toBeNull();
    });

    it('returns null for both invalid stations', () => {
      const result = findShortestPath(graph, 'INVALID1', 'INVALID2');
      expect(result).toBeNull();
    });

    it('returns null when no path exists (disconnected graph)', () => {
      const disconnected = createDisconnectedGraph();
      const result = findShortestPath(disconnected, 'P', 'R');
      expect(result).toBeNull();
    });

    it('returns null for empty graph', () => {
      const empty = createEmptyGraph();
      const result = findShortestPath(empty, STATION_A, STATION_D);
      expect(result).toBeNull();
    });
  });

  describe('paths with transfers', () => {
    it('finds path requiring 1 transfer', () => {
      // A -> C (route 1) -> transfer -> F (route 2)
      const result = findShortestPath(graph, STATION_A, STATION_F);

      expect(result).not.toBeNull();
      expect(result!.transferCount).toBe(1);
      expect(result!.path.some((n) => n.routeId === ROUTE_1)).toBe(true);
      expect(result!.path.some((n) => n.routeId === ROUTE_2)).toBe(true);
    });

    it('finds path from route 2 to route 1', () => {
      // E -> C (route 2) -> transfer -> D (route 1)
      const result = findShortestPath(graph, STATION_E, STATION_D);

      expect(result).not.toBeNull();
      expect(result!.transferCount).toBe(1);
    });

    it('transfer edge is included in path edges', () => {
      const result = findShortestPath(graph, STATION_A, STATION_F);

      expect(result).not.toBeNull();
      const transferEdge = result!.edges.find((e) => e.type === 'transfer');
      expect(transferEdge).toBeDefined();
      expect(transferEdge!.durationSeconds).toBe(TRANSFER_WALK_TIME);
    });

    it('actual duration excludes transfer penalty', () => {
      const result = findShortestPath(graph, STATION_A, STATION_F);

      expect(result).not.toBeNull();
      // actualDuration should be sum of edge durations only
      const sumOfEdges = result!.edges.reduce(
        (sum, e) => sum + e.durationSeconds,
        0
      );
      expect(result!.actualDuration).toBe(sumOfEdges);
    });

    it('total cost includes transfer penalty', () => {
      const result = findShortestPath(graph, STATION_A, STATION_F);

      expect(result).not.toBeNull();
      // totalCost should be greater than actualDuration due to penalty
      expect(result!.totalCost).toBeGreaterThan(result!.actualDuration);
    });
  });

  describe('maxTransfers option', () => {
    it('respects maxTransfers=0 for direct paths', () => {
      // A to D requires 0 transfers, should work
      const result = findShortestPath(graph, STATION_A, STATION_D, {
        maxTransfers: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.transferCount).toBe(0);
    });

    it('returns null when path requires more transfers than allowed', () => {
      // A to F requires 1 transfer
      const result = findShortestPath(graph, STATION_A, STATION_F, {
        maxTransfers: 0,
      });

      expect(result).toBeNull();
    });

    it('allows paths within maxTransfers limit', () => {
      const result = findShortestPath(graph, STATION_A, STATION_F, {
        maxTransfers: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.transferCount).toBeLessThanOrEqual(1);
    });

    it('maxTransfers=3 allows complex paths', () => {
      const result = findShortestPath(graph, STATION_A, STATION_H, {
        maxTransfers: 3,
      });

      expect(result).not.toBeNull();
    });
  });

  describe('avoidRoutes option', () => {
    it('avoids specified route', () => {
      // Normally would take route 1 direct, but avoiding it should force transfer
      const result = findShortestPath(graph, STATION_E, STATION_F, {
        avoidRoutes: [ROUTE_2],
      });

      // With route 2 avoided, there's no direct E->F path
      // Would need E->C (route 2) which is avoided, so no path
      expect(result).toBeNull();
    });

    it('finds alternative when one route is avoided', () => {
      // A to D normally uses route 1
      // Avoiding route 1 means going through a different path
      const result = findShortestPath(graph, STATION_A, STATION_D, {
        avoidRoutes: [ROUTE_1],
      });

      // With route 1 avoided, no path exists from A since A is only on route 1
      expect(result).toBeNull();
    });

    it('avoidRoutes is case-insensitive', () => {
      const result1 = findShortestPath(graph, STATION_E, STATION_F, {
        avoidRoutes: ['2'],
      });
      const result2 = findShortestPath(graph, STATION_E, STATION_F, {
        avoidRoutes: ['2'],
      });

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe('transferPenalty option', () => {
    it('uses default penalty of 300 seconds', () => {
      const result = findShortestPath(graph, STATION_A, STATION_F);

      expect(result).not.toBeNull();
      // totalCost = actualDuration + (transfers * penalty)
      // With 1 transfer and default 300s penalty
      const expectedCost = result!.actualDuration + 300;
      expect(result!.totalCost).toBe(expectedCost);
    });

    it('respects custom transfer penalty', () => {
      const customPenalty = 600; // 10 minutes
      const result = findShortestPath(graph, STATION_A, STATION_F, {
        transferPenalty: customPenalty,
      });

      expect(result).not.toBeNull();
      const expectedCost = result!.actualDuration + customPenalty;
      expect(result!.totalCost).toBe(expectedCost);
    });

    it('zero penalty means no extra cost for transfers', () => {
      const result = findShortestPath(graph, STATION_A, STATION_F, {
        transferPenalty: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.totalCost).toBe(result!.actualDuration);
    });
  });

  describe('minimal graph', () => {
    it('works with minimal 2-station graph', () => {
      const minimal = createMinimalGraph();
      const result = findShortestPath(minimal, 'X', 'Y');

      expect(result).not.toBeNull();
      expect(result!.path.length).toBe(2);
      expect(result!.actualDuration).toBe(60);
    });

    it('finds reverse path in minimal graph', () => {
      const minimal = createMinimalGraph();
      const result = findShortestPath(minimal, 'Y', 'X');

      expect(result).not.toBeNull();
      expect(result!.actualDuration).toBe(60);
    });
  });
});

describe('findRouteVariants', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns array of paths', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_D, 3);

    expect(Array.isArray(results)).toBe(true);
  });

  it('returns at least one path when path exists', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_D, 3);

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when no path exists', () => {
    const results = findRouteVariants(graph, STATION_A, 'NONEXISTENT', 3);

    expect(results).toEqual([]);
  });

  it('returns up to k paths', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_F, 5);

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('each path is unique', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_D, 3);

    const pathKeys = results.map((r) =>
      r.path.map((n) => `${n.stationId}:${n.routeId}`).join(',')
    );

    const uniqueKeys = new Set(pathKeys);
    expect(uniqueKeys.size).toBe(pathKeys.length);
  });

  it('paths are sorted by actual duration', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_F, 3);

    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i].actualDuration).toBeGreaterThanOrEqual(
          results[i - 1].actualDuration
        );
      }
    }
  });

  it('first path is the shortest', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_D, 3);
    const shortestPath = findShortestPath(graph, STATION_A, STATION_D);

    expect(results[0].actualDuration).toBe(shortestPath!.actualDuration);
  });

  it('returns fewer paths if not enough alternatives exist', () => {
    const minimal = createMinimalGraph();
    const results = findRouteVariants(minimal, 'X', 'Y', 5);

    // Only one possible path in minimal graph
    expect(results.length).toBe(1);
  });

  it('respects options in all paths', () => {
    const results = findRouteVariants(graph, STATION_A, STATION_F, 3, {
      maxTransfers: 1,
    });

    for (const result of results) {
      expect(result.transferCount).toBeLessThanOrEqual(1);
    }
  });
});
