/**
 * Trip Planner
 *
 * Main entry point for the NYC Subway trip planning system.
 * Provides functions to find optimal routes between stations.
 */

// Re-export types
export * from './types';

// Re-export graph utilities
export {
  getTransitGraph,
  clearGraphCache,
  getStationNodes,
  getNodeEdges,
  hasStation,
  getStationInfo,
} from './graph-builder';

// Re-export pathfinding
export { findShortestPath, findAlternativePaths } from './dijkstra';

// Re-export path conversion
export { convertPathToTrip, generateDirections, getTripSummary } from './path-converter';

import type { TripPlan, TripPlannerOptions } from './types';
import { getTransitGraph, hasStation } from './graph-builder';
import { findShortestPath, findAlternativePaths } from './dijkstra';
import { convertPathToTrip } from './path-converter';

/**
 * Plan a trip between two stations
 *
 * @param originStationId - The starting station ID
 * @param destStationId - The destination station ID
 * @param options - Planning options (maxTransfers, avoidRoutes, etc.)
 * @returns A trip plan, or null if no route found
 */
export async function planTrip(
  originStationId: string,
  destStationId: string,
  options?: TripPlannerOptions
): Promise<TripPlan | null> {
  const graph = await getTransitGraph();

  // Validate stations exist
  if (!hasStation(graph, originStationId)) {
    console.warn(`[trip-planner] Origin station not found: ${originStationId}`);
    return null;
  }
  if (!hasStation(graph, destStationId)) {
    console.warn(`[trip-planner] Destination station not found: ${destStationId}`);
    return null;
  }

  // Find shortest path
  const result = findShortestPath(graph, originStationId, destStationId, options);
  if (!result) {
    return null;
  }

  // Convert to trip plan
  return convertPathToTrip(graph, result);
}

/**
 * Get alternative trip plans between two stations
 *
 * @param originStationId - The starting station ID
 * @param destStationId - The destination station ID
 * @param count - Number of alternatives to find (default: 3)
 * @param options - Planning options
 * @returns Array of trip plans, sorted by duration
 */
export async function getAlternativeTrips(
  originStationId: string,
  destStationId: string,
  count: number = 3,
  options?: TripPlannerOptions
): Promise<TripPlan[]> {
  const graph = await getTransitGraph();

  // Validate stations exist
  if (!hasStation(graph, originStationId)) {
    console.warn(`[trip-planner] Origin station not found: ${originStationId}`);
    return [];
  }
  if (!hasStation(graph, destStationId)) {
    console.warn(`[trip-planner] Destination station not found: ${destStationId}`);
    return [];
  }

  // Find alternative paths
  const results = findAlternativePaths(graph, originStationId, destStationId, count, options);

  // Convert all to trip plans
  return results.map((result) => convertPathToTrip(graph, result));
}

/**
 * Initialize the trip planner by preloading the transit graph
 * Call this early in app startup for faster first queries
 */
export async function initTripPlanner(): Promise<void> {
  await getTransitGraph();
}

/**
 * Check if a station ID is valid
 */
export async function isValidStation(stationId: string): Promise<boolean> {
  const graph = await getTransitGraph();
  return hasStation(graph, stationId);
}
