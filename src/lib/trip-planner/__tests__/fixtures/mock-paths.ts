/**
 * Mock Pathfinding Results for Testing
 *
 * Pre-built PathfindingResult objects for testing path-converter.ts
 * These correspond to paths in the mock graph from mock-graph.ts
 */

import type { PathfindingResult, GraphNode, GraphEdge } from '../../types';
import {
  STATION_A,
  STATION_B,
  STATION_C,
  STATION_D,
  STATION_E,
  STATION_F,
  ROUTE_1,
  ROUTE_2,
  DURATION_SHORT,
  DURATION_MEDIUM,
  TRANSFER_WALK_TIME,
} from './mock-graph';

/**
 * Simple path: A -> B -> C -> D on Route 1 (no transfers)
 */
export function createSimplePath(): PathfindingResult {
  const path: GraphNode[] = [
    { stationId: STATION_A, routeId: ROUTE_1 },
    { stationId: STATION_B, routeId: ROUTE_1 },
    { stationId: STATION_C, routeId: ROUTE_1 },
    { stationId: STATION_D, routeId: ROUTE_1 },
  ];

  const edges: GraphEdge[] = [
    {
      type: 'ride',
      from: { stationId: STATION_A, routeId: ROUTE_1 },
      to: { stationId: STATION_B, routeId: ROUTE_1 },
      durationSeconds: DURATION_SHORT,
    },
    {
      type: 'ride',
      from: { stationId: STATION_B, routeId: ROUTE_1 },
      to: { stationId: STATION_C, routeId: ROUTE_1 },
      durationSeconds: DURATION_SHORT,
    },
    {
      type: 'ride',
      from: { stationId: STATION_C, routeId: ROUTE_1 },
      to: { stationId: STATION_D, routeId: ROUTE_1 },
      durationSeconds: DURATION_SHORT,
    },
  ];

  return {
    path,
    edges,
    totalCost: 180, // 60 + 60 + 60
    actualDuration: 180,
    transferCount: 0,
  };
}

/**
 * Path with 1 transfer: A -> B -> C (transfer) -> F
 * Route 1 to Route 2 at Station C
 */
export function createSingleTransferPath(): PathfindingResult {
  const path: GraphNode[] = [
    { stationId: STATION_A, routeId: ROUTE_1 },
    { stationId: STATION_B, routeId: ROUTE_1 },
    { stationId: STATION_C, routeId: ROUTE_1 },
    { stationId: STATION_C, routeId: ROUTE_2 }, // After transfer
    { stationId: STATION_F, routeId: ROUTE_2 },
  ];

  const edges: GraphEdge[] = [
    {
      type: 'ride',
      from: { stationId: STATION_A, routeId: ROUTE_1 },
      to: { stationId: STATION_B, routeId: ROUTE_1 },
      durationSeconds: DURATION_SHORT,
    },
    {
      type: 'ride',
      from: { stationId: STATION_B, routeId: ROUTE_1 },
      to: { stationId: STATION_C, routeId: ROUTE_1 },
      durationSeconds: DURATION_SHORT,
    },
    {
      type: 'transfer',
      from: { stationId: STATION_C, routeId: ROUTE_1 },
      to: { stationId: STATION_C, routeId: ROUTE_2 },
      durationSeconds: TRANSFER_WALK_TIME,
      transferType: 'in-system',
      complexId: 'transfer_C',
    },
    {
      type: 'ride',
      from: { stationId: STATION_C, routeId: ROUTE_2 },
      to: { stationId: STATION_F, routeId: ROUTE_2 },
      durationSeconds: DURATION_MEDIUM,
    },
  ];

  return {
    path,
    edges,
    totalCost: 540, // 60 + 60 + 30 + 300 (penalty) + 90
    actualDuration: 240, // 60 + 60 + 30 + 90 (without penalty)
    transferCount: 1,
  };
}

/**
 * Path with 2 transfers: E -> C (transfer) -> C (transfer) -> D
 * This is a contrived example for testing multi-transfer scenarios
 * Route 2 -> Route 3 -> Route 1
 */
export function createDoubleTransferPath(): PathfindingResult {
  const ROUTE_3 = '3';

  const path: GraphNode[] = [
    { stationId: STATION_E, routeId: ROUTE_2 },
    { stationId: STATION_C, routeId: ROUTE_2 },
    { stationId: STATION_C, routeId: ROUTE_3 }, // First transfer
    { stationId: STATION_C, routeId: ROUTE_1 }, // Second transfer
    { stationId: STATION_D, routeId: ROUTE_1 },
  ];

  const edges: GraphEdge[] = [
    {
      type: 'ride',
      from: { stationId: STATION_E, routeId: ROUTE_2 },
      to: { stationId: STATION_C, routeId: ROUTE_2 },
      durationSeconds: DURATION_MEDIUM,
    },
    {
      type: 'transfer',
      from: { stationId: STATION_C, routeId: ROUTE_2 },
      to: { stationId: STATION_C, routeId: ROUTE_3 },
      durationSeconds: TRANSFER_WALK_TIME,
      transferType: 'in-system',
      complexId: 'transfer_C',
    },
    {
      type: 'transfer',
      from: { stationId: STATION_C, routeId: ROUTE_3 },
      to: { stationId: STATION_C, routeId: ROUTE_1 },
      durationSeconds: TRANSFER_WALK_TIME,
      transferType: 'in-system',
      complexId: 'transfer_C',
    },
    {
      type: 'ride',
      from: { stationId: STATION_C, routeId: ROUTE_1 },
      to: { stationId: STATION_D, routeId: ROUTE_1 },
      durationSeconds: DURATION_SHORT,
    },
  ];

  return {
    path,
    edges,
    totalCost: 810, // 90 + 30 + 300 + 30 + 300 + 60 (with penalties)
    actualDuration: 210, // 90 + 30 + 30 + 60 (without penalties)
    transferCount: 2,
  };
}

/**
 * Minimal path: just 2 stations, 1 ride edge
 */
export function createMinimalPath(): PathfindingResult {
  const path: GraphNode[] = [
    { stationId: 'X', routeId: '1' },
    { stationId: 'Y', routeId: '1' },
  ];

  const edges: GraphEdge[] = [
    {
      type: 'ride',
      from: { stationId: 'X', routeId: '1' },
      to: { stationId: 'Y', routeId: '1' },
      durationSeconds: 60,
    },
  ];

  return {
    path,
    edges,
    totalCost: 60,
    actualDuration: 60,
    transferCount: 0,
  };
}

/**
 * Expected TripPlan output for simple path (for assertion)
 */
export const EXPECTED_SIMPLE_TRIP = {
  origin: { id: STATION_A, name: 'Station A' },
  destination: { id: STATION_D, name: 'Station D' },
  totalDurationSeconds: 180,
  totalTransfers: 0,
  totalWalkingSeconds: 0,
  routes: [ROUTE_1],
  segmentCount: 3, // board + ride + exit
};

/**
 * Expected TripPlan output for single transfer path (for assertion)
 */
export const EXPECTED_SINGLE_TRANSFER_TRIP = {
  origin: { id: STATION_A, name: 'Station A' },
  destination: { id: STATION_F, name: 'Station F' },
  totalDurationSeconds: 240,
  totalTransfers: 1,
  totalWalkingSeconds: TRANSFER_WALK_TIME,
  routes: [ROUTE_1, ROUTE_2],
  segmentCount: 6, // board + ride + transfer + board + ride + exit
};
