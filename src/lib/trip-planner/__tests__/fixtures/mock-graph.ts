/**
 * Mock Transit Graph for Testing
 *
 * Creates a minimal, deterministic graph for unit testing pathfinding.
 *
 * Graph Layout:
 * ```
 * Route 1: A -- B -- C -- D
 *                    |
 * Route 2: E --------+-- F
 *                    |
 * Route 3:     G ----+-- H
 * ```
 *
 * Station C is a transfer point between routes 1, 2, and 3.
 * All durations are deterministic for predictable test assertions.
 */

import type { TransitGraph, GraphNode, GraphEdge } from '../../types';
import { nodeKey } from '../../types';

// Station IDs
export const STATION_A = 'A';
export const STATION_B = 'B';
export const STATION_C = 'C'; // Transfer station
export const STATION_D = 'D';
export const STATION_E = 'E';
export const STATION_F = 'F';
export const STATION_G = 'G';
export const STATION_H = 'H';

// Route IDs
export const ROUTE_1 = '1';
export const ROUTE_2 = '2';
export const ROUTE_3 = '3';

// Durations in seconds (deterministic)
export const DURATION_SHORT = 60; // 1 minute
export const DURATION_MEDIUM = 90; // 1.5 minutes
export const DURATION_LONG = 120; // 2 minutes
export const TRANSFER_WALK_TIME = 30; // 30 seconds

// Station metadata
const STATION_INFO: Record<string, { name: string; lat: number; lon: number }> = {
  [STATION_A]: { name: 'Station A', lat: 40.7, lon: -74.0 },
  [STATION_B]: { name: 'Station B', lat: 40.71, lon: -74.01 },
  [STATION_C]: { name: 'Station C (Transfer)', lat: 40.72, lon: -74.02 },
  [STATION_D]: { name: 'Station D', lat: 40.73, lon: -74.03 },
  [STATION_E]: { name: 'Station E', lat: 40.72, lon: -74.05 },
  [STATION_F]: { name: 'Station F', lat: 40.72, lon: -74.0 },
  [STATION_G]: { name: 'Station G', lat: 40.74, lon: -74.02 },
  [STATION_H]: { name: 'Station H', lat: 40.74, lon: -74.0 },
};

/**
 * Create a mock transit graph for testing
 */
export function createMockGraph(): TransitGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const stationToNodes = new Map<string, string[]>();
  const stations = new Map(Object.entries(STATION_INFO));

  // Helper to add a node
  const addNode = (stationId: string, routeId: string): string => {
    const key = nodeKey(stationId, routeId);
    nodes.set(key, { stationId, routeId });

    if (!stationToNodes.has(stationId)) {
      stationToNodes.set(stationId, []);
    }
    stationToNodes.get(stationId)!.push(key);

    return key;
  };

  // Helper to add bidirectional ride edge
  const addRideEdge = (
    fromStation: string,
    toStation: string,
    routeId: string,
    duration: number
  ): void => {
    const fromKey = nodeKey(fromStation, routeId);
    const toKey = nodeKey(toStation, routeId);

    // Forward edge
    if (!edges.has(fromKey)) edges.set(fromKey, []);
    edges.get(fromKey)!.push({
      type: 'ride',
      from: { stationId: fromStation, routeId },
      to: { stationId: toStation, routeId },
      durationSeconds: duration,
    });

    // Reverse edge
    if (!edges.has(toKey)) edges.set(toKey, []);
    edges.get(toKey)!.push({
      type: 'ride',
      from: { stationId: toStation, routeId },
      to: { stationId: fromStation, routeId },
      durationSeconds: duration,
    });
  };

  // Helper to add transfer edge (bidirectional)
  const addTransferEdge = (
    stationId: string,
    fromRoute: string,
    toRoute: string,
    walkTime: number,
    transferType: 'in-system' | 'out-of-system' = 'in-system'
  ): void => {
    const fromKey = nodeKey(stationId, fromRoute);
    const toKey = nodeKey(stationId, toRoute);

    if (!edges.has(fromKey)) edges.set(fromKey, []);
    edges.get(fromKey)!.push({
      type: 'transfer',
      from: { stationId, routeId: fromRoute },
      to: { stationId, routeId: toRoute },
      durationSeconds: walkTime,
      transferType,
      complexId: `transfer_${stationId}`,
    });

    if (!edges.has(toKey)) edges.set(toKey, []);
    edges.get(toKey)!.push({
      type: 'transfer',
      from: { stationId, routeId: toRoute },
      to: { stationId, routeId: fromRoute },
      durationSeconds: walkTime,
      transferType,
      complexId: `transfer_${stationId}`,
    });
  };

  // ===== Route 1: A -> B -> C -> D =====
  addNode(STATION_A, ROUTE_1);
  addNode(STATION_B, ROUTE_1);
  addNode(STATION_C, ROUTE_1);
  addNode(STATION_D, ROUTE_1);

  addRideEdge(STATION_A, STATION_B, ROUTE_1, DURATION_SHORT); // 60s
  addRideEdge(STATION_B, STATION_C, ROUTE_1, DURATION_SHORT); // 60s
  addRideEdge(STATION_C, STATION_D, ROUTE_1, DURATION_SHORT); // 60s

  // ===== Route 2: E -> C -> F =====
  addNode(STATION_E, ROUTE_2);
  addNode(STATION_C, ROUTE_2);
  addNode(STATION_F, ROUTE_2);

  addRideEdge(STATION_E, STATION_C, ROUTE_2, DURATION_MEDIUM); // 90s
  addRideEdge(STATION_C, STATION_F, ROUTE_2, DURATION_MEDIUM); // 90s

  // ===== Route 3: G -> C -> H =====
  addNode(STATION_G, ROUTE_3);
  addNode(STATION_C, ROUTE_3);
  addNode(STATION_H, ROUTE_3);

  addRideEdge(STATION_G, STATION_C, ROUTE_3, DURATION_LONG); // 120s
  addRideEdge(STATION_C, STATION_H, ROUTE_3, DURATION_LONG); // 120s

  // ===== Transfer edges at Station C =====
  addTransferEdge(STATION_C, ROUTE_1, ROUTE_2, TRANSFER_WALK_TIME);
  addTransferEdge(STATION_C, ROUTE_1, ROUTE_3, TRANSFER_WALK_TIME);
  addTransferEdge(STATION_C, ROUTE_2, ROUTE_3, TRANSFER_WALK_TIME);

  return {
    nodes,
    edges,
    stationToNodes,
    stations,
  };
}

/**
 * Expected shortest paths in the mock graph
 * (for use in test assertions)
 */
export const EXPECTED_PATHS = {
  // Direct paths (no transfers)
  A_TO_D: {
    duration: 180, // 60 + 60 + 60
    transfers: 0,
    routes: [ROUTE_1],
    stops: 3,
  },
  E_TO_F: {
    duration: 180, // 90 + 90
    transfers: 0,
    routes: [ROUTE_2],
    stops: 2,
  },

  // Paths requiring 1 transfer
  A_TO_F: {
    duration: 150 + TRANSFER_WALK_TIME, // A->B->C (120) + transfer (30) + C->F (90) - but penalty makes it 120+30+90
    actualDuration: 210, // Without penalty: 60+60+30+90
    transfers: 1,
    routes: [ROUTE_1, ROUTE_2],
  },
  E_TO_D: {
    duration: 150 + TRANSFER_WALK_TIME, // E->C (90) + transfer (30) + C->D (60)
    actualDuration: 180, // Without penalty: 90+30+60
    transfers: 1,
    routes: [ROUTE_2, ROUTE_1],
  },

  // Paths requiring 2 transfers
  A_TO_H: {
    transfers: 2, // A->C (route 1) -> C (route 2 or 3) -> H
    routes: [ROUTE_1, ROUTE_3], // Most direct
  },
};

/**
 * Create a minimal graph with only 2 stations (for edge case testing)
 */
export function createMinimalGraph(): TransitGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const stationToNodes = new Map<string, string[]>();
  const stations = new Map<string, { name: string; lat: number; lon: number }>();

  const key1 = nodeKey('X', '1');
  const key2 = nodeKey('Y', '1');

  nodes.set(key1, { stationId: 'X', routeId: '1' });
  nodes.set(key2, { stationId: 'Y', routeId: '1' });

  stationToNodes.set('X', [key1]);
  stationToNodes.set('Y', [key2]);

  stations.set('X', { name: 'Station X', lat: 40.0, lon: -74.0 });
  stations.set('Y', { name: 'Station Y', lat: 40.1, lon: -74.1 });

  edges.set(key1, [
    {
      type: 'ride',
      from: { stationId: 'X', routeId: '1' },
      to: { stationId: 'Y', routeId: '1' },
      durationSeconds: 60,
    },
  ]);

  edges.set(key2, [
    {
      type: 'ride',
      from: { stationId: 'Y', routeId: '1' },
      to: { stationId: 'X', routeId: '1' },
      durationSeconds: 60,
    },
  ]);

  return { nodes, edges, stationToNodes, stations };
}

/**
 * Create an empty graph (for edge case testing)
 */
export function createEmptyGraph(): TransitGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    stationToNodes: new Map(),
    stations: new Map(),
  };
}

/**
 * Create a disconnected graph (two separate components)
 */
export function createDisconnectedGraph(): TransitGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const stationToNodes = new Map<string, string[]>();
  const stations = new Map<string, { name: string; lat: number; lon: number }>();

  // Component 1: P -> Q on route 1
  const keyP = nodeKey('P', '1');
  const keyQ = nodeKey('Q', '1');
  nodes.set(keyP, { stationId: 'P', routeId: '1' });
  nodes.set(keyQ, { stationId: 'Q', routeId: '1' });
  stationToNodes.set('P', [keyP]);
  stationToNodes.set('Q', [keyQ]);
  stations.set('P', { name: 'Station P', lat: 40.0, lon: -74.0 });
  stations.set('Q', { name: 'Station Q', lat: 40.1, lon: -74.0 });

  edges.set(keyP, [
    {
      type: 'ride',
      from: { stationId: 'P', routeId: '1' },
      to: { stationId: 'Q', routeId: '1' },
      durationSeconds: 60,
    },
  ]);
  edges.set(keyQ, [
    {
      type: 'ride',
      from: { stationId: 'Q', routeId: '1' },
      to: { stationId: 'P', routeId: '1' },
      durationSeconds: 60,
    },
  ]);

  // Component 2: R -> S on route 2 (disconnected from route 1)
  const keyR = nodeKey('R', '2');
  const keyS = nodeKey('S', '2');
  nodes.set(keyR, { stationId: 'R', routeId: '2' });
  nodes.set(keyS, { stationId: 'S', routeId: '2' });
  stationToNodes.set('R', [keyR]);
  stationToNodes.set('S', [keyS]);
  stations.set('R', { name: 'Station R', lat: 41.0, lon: -75.0 });
  stations.set('S', { name: 'Station S', lat: 41.1, lon: -75.0 });

  edges.set(keyR, [
    {
      type: 'ride',
      from: { stationId: 'R', routeId: '2' },
      to: { stationId: 'S', routeId: '2' },
      durationSeconds: 60,
    },
  ]);
  edges.set(keyS, [
    {
      type: 'ride',
      from: { stationId: 'S', routeId: '2' },
      to: { stationId: 'R', routeId: '2' },
      durationSeconds: 60,
    },
  ]);

  return { nodes, edges, stationToNodes, stations };
}
