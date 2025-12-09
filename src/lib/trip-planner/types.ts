/**
 * Trip Planner Types
 *
 * Type definitions for the NYC subway trip planning system.
 */

// ============================================
// Graph Types
// ============================================

/**
 * A node in the transit graph represents being at a station on a specific route.
 * This allows modeling that transferring from route A to route B at the same
 * station has a cost (walk time).
 */
export interface GraphNode {
  stationId: string;
  routeId: string;
}

/**
 * An edge in the transit graph represents either:
 * - A ride segment between two consecutive stops on a route
 * - A transfer between routes at a transfer station
 */
export interface GraphEdge {
  type: 'ride' | 'transfer';
  from: GraphNode;
  to: GraphNode;
  durationSeconds: number;
  /** For transfers: whether it's in-system or out-of-system */
  transferType?: 'in-system' | 'out-of-system';
  /** For transfers: the complex ID */
  complexId?: string;
}

/**
 * The transit graph for pathfinding
 */
export interface TransitGraph {
  /** All nodes in the graph, keyed by nodeKey(stationId, routeId) */
  nodes: Map<string, GraphNode>;
  /** Adjacency list: fromNodeKey -> list of edges */
  edges: Map<string, GraphEdge[]>;
  /** Quick lookup: stationId -> list of nodeKeys at that station */
  stationToNodes: Map<string, string[]>;
  /** Station metadata for display */
  stations: Map<string, { name: string; lat: number; lon: number }>;
}

// ============================================
// Trip Planning Types
// ============================================

/**
 * A segment of a trip (one leg of the journey)
 */
export interface TripSegment {
  /** Type of segment */
  type: 'board' | 'ride' | 'transfer' | 'exit';
  /** Route ID (for board/ride segments) */
  routeId?: string;
  /** Starting station */
  fromStation: {
    id: string;
    name: string;
  };
  /** Ending station */
  toStation: {
    id: string;
    name: string;
  };
  /** Duration in seconds */
  durationSeconds: number;
  /** Number of stops (for ride segments) */
  stopCount?: number;
  /** Headsign/direction (for board segments) */
  direction?: string;
  /** Transfer type (for transfer segments) */
  transferType?: 'in-system' | 'out-of-system';
}

/**
 * A complete trip plan from origin to destination
 */
export interface TripPlan {
  /** Unique ID for this plan */
  id: string;
  /** Origin station */
  origin: {
    id: string;
    name: string;
  };
  /** Destination station */
  destination: {
    id: string;
    name: string;
  };
  /** Ordered list of segments */
  segments: TripSegment[];
  /** Total duration in seconds */
  totalDurationSeconds: number;
  /** Number of transfers */
  totalTransfers: number;
  /** Total walking time (transfer time) in seconds */
  totalWalkingSeconds: number;
  /** Routes used in this trip */
  routes: string[];
}

/**
 * Options for trip planning
 */
export interface TripPlannerOptions {
  /** Maximum number of transfers allowed (default: 3) */
  maxTransfers?: number;
  /** Prefer routes with fewer transfers even if slightly longer */
  preferFewerTransfers?: boolean;
  /** Routes to avoid (e.g., due to delays) */
  avoidRoutes?: string[];
  /** Weight for transfer penalty in seconds (default: 300 = 5 min) */
  transferPenalty?: number;
}

/**
 * Result from Dijkstra's algorithm
 */
export interface PathfindingResult {
  /** The path as a sequence of nodes */
  path: GraphNode[];
  /** The edges taken */
  edges: GraphEdge[];
  /** Total cost (including penalties) */
  totalCost: number;
  /** Actual travel time (without penalties) */
  actualDuration: number;
  /** Number of transfers */
  transferCount: number;
}

// ============================================
// Data File Types
// ============================================

/**
 * Transfer graph JSON structure (from transfer-graph.json)
 */
export interface TransferGraphData {
  complexes: TransferComplex[];
  transfers: TransferEdgeData[];
  meta: {
    generatedAt: string;
    complexCount: number;
    transferCount: number;
  };
}

export interface TransferComplex {
  id: string;
  name: string;
  stationIds: string[];
  routes: string[];
  walkTimeSeconds: number;
  type: 'in-system' | 'out-of-system';
}

export interface TransferEdgeData {
  fromStationId: string;
  toStationId: string;
  walkTimeSeconds: number;
  type: 'in-system' | 'out-of-system';
  complexId: string;
}

/**
 * Route segments JSON structure (from route-segments.json)
 */
export interface RouteSegmentsData {
  routes: {
    [routeId: string]: {
      directions: {
        [directionId: string]: {
          stops: string[];
          edges: Array<{
            from: string;
            to: string;
            seconds: number;
          }>;
        };
      };
    };
  };
  meta: {
    generatedAt: string;
    routeCount: number;
    totalEdges: number;
  };
}

// ============================================
// API Types
// ============================================

/**
 * Trip planning API request
 */
export interface TripPlanRequest {
  origin: string;
  destination: string;
  alternatives?: number;
  maxTransfers?: number;
  preferFewerTransfers?: boolean;
  avoidRoutes?: string[];
}

/**
 * Trip planning API response
 */
export interface TripPlanResponse {
  trips: TripPlan[];
  origin: string;
  destination: string;
  requestedAt: string;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Create a unique key for a graph node
 */
export function nodeKey(stationId: string, routeId: string): string {
  return `${stationId}:${routeId}`;
}

/**
 * Parse a node key back to stationId and routeId
 */
export function parseNodeKey(key: string): { stationId: string; routeId: string } {
  const [stationId, routeId] = key.split(':');
  return { stationId, routeId };
}
