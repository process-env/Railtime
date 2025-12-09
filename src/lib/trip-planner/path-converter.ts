/**
 * Path Converter
 *
 * Converts raw Dijkstra pathfinding results into human-readable trip plans
 * with segments for boarding, riding, transferring, and exiting.
 */

import type {
  TransitGraph,
  PathfindingResult,
  TripPlan,
  TripSegment,
  GraphNode,
  GraphEdge,
} from './types';
import { getStationInfo } from './graph-builder';

/**
 * Generate a unique ID for a trip plan
 */
function generateTripId(): string {
  return `trip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get station name from graph, with fallback
 */
function getStationName(graph: TransitGraph, stationId: string): string {
  const info = getStationInfo(graph, stationId);
  return info?.name || stationId;
}

/**
 * Convert a pathfinding result to a trip plan
 */
export function convertPathToTrip(
  graph: TransitGraph,
  result: PathfindingResult
): TripPlan {
  const segments: TripSegment[] = [];
  const routesUsed = new Set<string>();
  let totalWalkingSeconds = 0;

  if (result.path.length === 0) {
    throw new Error('Cannot convert empty path to trip');
  }

  const originStation = result.path[0];
  const destStation = result.path[result.path.length - 1];

  // Group consecutive ride edges on the same route
  let currentRideStart: GraphNode | null = null;
  let currentRideRoute: string | null = null;
  let currentRideDuration = 0;
  let currentRideStopCount = 0;

  // Process each edge in the path
  for (let i = 0; i < result.edges.length; i++) {
    const edge = result.edges[i];
    const isLastEdge = i === result.edges.length - 1;

    if (edge.type === 'ride') {
      // Starting a new ride or continuing
      if (currentRideRoute !== edge.from.routeId) {
        // Finish previous ride if any
        if (currentRideStart && currentRideRoute) {
          finishRideSegment();
        }

        // Start new ride with a board segment
        currentRideStart = edge.from;
        currentRideRoute = edge.from.routeId;
        currentRideDuration = 0;
        currentRideStopCount = 0;
        routesUsed.add(edge.from.routeId);

        segments.push({
          type: 'board',
          routeId: edge.from.routeId,
          fromStation: {
            id: edge.from.stationId,
            name: getStationName(graph, edge.from.stationId),
          },
          toStation: {
            id: edge.from.stationId,
            name: getStationName(graph, edge.from.stationId),
          },
          durationSeconds: 0,
        });
      }

      // Accumulate ride
      currentRideDuration += edge.durationSeconds;
      currentRideStopCount++;

      // If this is the last edge, finish the ride
      if (isLastEdge) {
        finishRideSegment(edge.to);
      }
    } else if (edge.type === 'transfer') {
      // Finish any ongoing ride
      if (currentRideStart && currentRideRoute) {
        finishRideSegment(edge.from);
      }

      // Skip transfer segments that end at the destination station
      // (these are just internal graph transitions, not real walking transfers)
      if (edge.to.stationId === destStation.stationId && isLastEdge) {
        continue;
      }

      // Also skip same-station transfers that are just route changes at destination
      if (edge.from.stationId === destStation.stationId) {
        continue;
      }

      // Add transfer segment
      totalWalkingSeconds += edge.durationSeconds;
      segments.push({
        type: 'transfer',
        fromStation: {
          id: edge.from.stationId,
          name: getStationName(graph, edge.from.stationId),
        },
        toStation: {
          id: edge.to.stationId,
          name: getStationName(graph, edge.to.stationId),
        },
        durationSeconds: edge.durationSeconds,
        transferType: edge.transferType,
      });
    }
  }

  // Helper to finish a ride segment
  function finishRideSegment(endNode?: GraphNode): void {
    if (!currentRideStart || !currentRideRoute) return;

    const endStation = endNode || result.path[result.path.length - 1];

    // Add ride segment
    segments.push({
      type: 'ride',
      routeId: currentRideRoute,
      fromStation: {
        id: currentRideStart.stationId,
        name: getStationName(graph, currentRideStart.stationId),
      },
      toStation: {
        id: endStation.stationId,
        name: getStationName(graph, endStation.stationId),
      },
      durationSeconds: currentRideDuration,
      stopCount: currentRideStopCount,
    });

    currentRideStart = null;
    currentRideRoute = null;
    currentRideDuration = 0;
    currentRideStopCount = 0;
  }

  // Add exit segment at the end
  segments.push({
    type: 'exit',
    fromStation: {
      id: destStation.stationId,
      name: getStationName(graph, destStation.stationId),
    },
    toStation: {
      id: destStation.stationId,
      name: getStationName(graph, destStation.stationId),
    },
    durationSeconds: 0,
  });

  return {
    id: generateTripId(),
    origin: {
      id: originStation.stationId,
      name: getStationName(graph, originStation.stationId),
    },
    destination: {
      id: destStation.stationId,
      name: getStationName(graph, destStation.stationId),
    },
    segments,
    totalDurationSeconds: result.actualDuration,
    totalTransfers: result.transferCount,
    totalWalkingSeconds,
    routes: Array.from(routesUsed),
  };
}

/**
 * Generate text directions from a trip plan
 */
export function generateDirections(plan: TripPlan): string[] {
  const directions: string[] = [];

  for (const segment of plan.segments) {
    switch (segment.type) {
      case 'board':
        directions.push(
          `Board the ${segment.routeId} train at ${segment.fromStation.name}`
        );
        break;

      case 'ride':
        const stopText = segment.stopCount === 1 ? '1 stop' : `${segment.stopCount} stops`;
        const durationMin = Math.round(segment.durationSeconds / 60);
        directions.push(
          `Ride ${stopText} to ${segment.toStation.name} (${durationMin} min)`
        );
        break;

      case 'transfer':
        const walkMin = Math.round(segment.durationSeconds / 60);
        if (segment.fromStation.id === segment.toStation.id) {
          directions.push(
            `Transfer at ${segment.fromStation.name} (${walkMin} min walk)`
          );
        } else {
          directions.push(
            `Walk from ${segment.fromStation.name} to ${segment.toStation.name} (${walkMin} min)`
          );
        }
        break;

      case 'exit':
        directions.push(`Arrive at ${segment.toStation.name}`);
        break;
    }
  }

  return directions;
}

/**
 * Get a summary of the trip
 */
export function getTripSummary(plan: TripPlan): string {
  const durationMin = Math.round(plan.totalDurationSeconds / 60);
  const routeList = plan.routes.join(', ');
  const transferText = plan.totalTransfers === 0
    ? 'no transfers'
    : plan.totalTransfers === 1
    ? '1 transfer'
    : `${plan.totalTransfers} transfers`;

  return `${durationMin} min via ${routeList} (${transferText})`;
}
