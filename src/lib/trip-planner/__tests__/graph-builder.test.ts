/**
 * Tests for graph builder utilities
 *
 * Note: These tests use the mock graph since testing the actual graph builder
 * would require mocking the file system. The utility functions work the same
 * way regardless of how the graph was constructed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getStationNodes, getNodeEdges, hasStation, getStationInfo } from '../graph-builder';
import {
  createMockGraph,
  createEmptyGraph,
  STATION_A,
  STATION_C,
  STATION_D,
  ROUTE_1,
  ROUTE_2,
  ROUTE_3,
} from './fixtures/mock-graph';
import type { TransitGraph } from '../types';

describe('getStationNodes', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns all nodes at multi-route station', () => {
    // Station C has routes 1, 2, and 3
    const nodes = getStationNodes(graph, STATION_C);

    expect(nodes.length).toBe(3);
    expect(nodes.some((n) => n.routeId === ROUTE_1)).toBe(true);
    expect(nodes.some((n) => n.routeId === ROUTE_2)).toBe(true);
    expect(nodes.some((n) => n.routeId === ROUTE_3)).toBe(true);
  });

  it('returns single node at single-route station', () => {
    // Station A only has route 1
    const nodes = getStationNodes(graph, STATION_A);

    expect(nodes.length).toBe(1);
    expect(nodes[0].routeId).toBe(ROUTE_1);
    expect(nodes[0].stationId).toBe(STATION_A);
  });

  it('returns empty array for unknown station', () => {
    const nodes = getStationNodes(graph, 'NONEXISTENT');

    expect(nodes).toEqual([]);
  });

  it('returns empty array for empty graph', () => {
    const empty = createEmptyGraph();
    const nodes = getStationNodes(empty, STATION_A);

    expect(nodes).toEqual([]);
  });

  it('all returned nodes have correct stationId', () => {
    const nodes = getStationNodes(graph, STATION_C);

    for (const node of nodes) {
      expect(node.stationId).toBe(STATION_C);
    }
  });
});

describe('getNodeEdges', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns ride edges for route stations', () => {
    const node = { stationId: STATION_A, routeId: ROUTE_1 };
    const edges = getNodeEdges(graph, node);

    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.type === 'ride')).toBe(true);
  });

  it('returns transfer edges at transfer stations', () => {
    const node = { stationId: STATION_C, routeId: ROUTE_1 };
    const edges = getNodeEdges(graph, node);

    expect(edges.some((e) => e.type === 'transfer')).toBe(true);
  });

  it('returns both ride and transfer edges at transfer stations', () => {
    const node = { stationId: STATION_C, routeId: ROUTE_1 };
    const edges = getNodeEdges(graph, node);

    const rideEdges = edges.filter((e) => e.type === 'ride');
    const transferEdges = edges.filter((e) => e.type === 'transfer');

    expect(rideEdges.length).toBeGreaterThan(0);
    expect(transferEdges.length).toBeGreaterThan(0);
  });

  it('returns empty array for non-existent node', () => {
    const node = { stationId: 'NONEXISTENT', routeId: 'X' };
    const edges = getNodeEdges(graph, node);

    expect(edges).toEqual([]);
  });

  it('all returned edges have matching from node', () => {
    const node = { stationId: STATION_C, routeId: ROUTE_1 };
    const edges = getNodeEdges(graph, node);

    for (const edge of edges) {
      expect(edge.from.stationId).toBe(node.stationId);
      expect(edge.from.routeId).toBe(node.routeId);
    }
  });

  it('ride edges go to adjacent stations', () => {
    const node = { stationId: STATION_A, routeId: ROUTE_1 };
    const edges = getNodeEdges(graph, node);
    const rideEdges = edges.filter((e) => e.type === 'ride');

    // A is only connected to B on route 1
    expect(rideEdges.length).toBe(1);
    expect(rideEdges[0].to.stationId).toBe('B');
  });

  it('transfer edges stay at same station', () => {
    const node = { stationId: STATION_C, routeId: ROUTE_1 };
    const edges = getNodeEdges(graph, node);
    const transferEdges = edges.filter((e) => e.type === 'transfer');

    for (const edge of transferEdges) {
      expect(edge.to.stationId).toBe(STATION_C);
      expect(edge.to.routeId).not.toBe(ROUTE_1);
    }
  });
});

describe('hasStation', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns true for valid station', () => {
    expect(hasStation(graph, STATION_A)).toBe(true);
    expect(hasStation(graph, STATION_C)).toBe(true);
    expect(hasStation(graph, STATION_D)).toBe(true);
  });

  it('returns false for invalid station', () => {
    expect(hasStation(graph, 'NONEXISTENT')).toBe(false);
    expect(hasStation(graph, '')).toBe(false);
    expect(hasStation(graph, 'XYZ')).toBe(false);
  });

  it('returns false for empty graph', () => {
    const empty = createEmptyGraph();
    expect(hasStation(empty, STATION_A)).toBe(false);
  });
});

describe('getStationInfo', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns station info with name, lat, lon', () => {
    const info = getStationInfo(graph, STATION_A);

    expect(info).toBeDefined();
    expect(info!.name).toBeDefined();
    expect(typeof info!.name).toBe('string');
    expect(typeof info!.lat).toBe('number');
    expect(typeof info!.lon).toBe('number');
  });

  it('returns correct station name', () => {
    const info = getStationInfo(graph, STATION_A);

    expect(info!.name).toBe('Station A');
  });

  it('returns undefined for invalid station', () => {
    const info = getStationInfo(graph, 'NONEXISTENT');

    expect(info).toBeUndefined();
  });

  it('returns undefined for empty graph', () => {
    const empty = createEmptyGraph();
    const info = getStationInfo(empty, STATION_A);

    expect(info).toBeUndefined();
  });

  it('returns valid coordinates', () => {
    const info = getStationInfo(graph, STATION_A);

    // Coordinates should be in valid NYC range (roughly)
    expect(info!.lat).toBeGreaterThan(40);
    expect(info!.lat).toBeLessThan(41);
    expect(info!.lon).toBeLessThan(-73);
    expect(info!.lon).toBeGreaterThan(-75);
  });
});
