/**
 * Graph Builder
 *
 * Constructs a transit graph from route segments and transfer data.
 * The graph is used for pathfinding to find optimal routes.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  TransitGraph,
  GraphNode,
  GraphEdge,
  TransferGraphData,
  RouteSegmentsData,
} from './types';
import { nodeKey } from './types';

// Singleton cache for the transit graph
let graphCache: TransitGraph | null = null;
let graphPromise: Promise<TransitGraph> | null = null;

/**
 * Get the path to public data files
 */
function getDataPath(filename: string): string {
  return path.join(process.cwd(), 'public', 'data', filename);
}

/**
 * Parse a CSV line respecting quoted fields.
 * Handles escaped quotes ("") within quoted fields per RFC 4180.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Load station data from stops.txt
 */
async function loadStations(): Promise<Map<string, { name: string; lat: number; lon: number }>> {
  const text = await fs.readFile(getDataPath('stops.txt'), 'utf-8');

  const stations = new Map<string, { name: string; lat: number; lon: number }>();
  const lines = text.split('\n').slice(1);

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = parseCSVLine(line);
    const stopId = parts[0]?.trim();
    const name = parts[1]?.trim();
    const lat = parseFloat(parts[2]);
    const lon = parseFloat(parts[3]);
    const locationType = parts[4]?.trim();

    // Only include parent stations
    if (stopId && name && locationType === '1' && !isNaN(lat) && !isNaN(lon)) {
      stations.set(stopId, { name, lat, lon });
    }
  }

  return stations;
}

/**
 * Load transfer graph data
 */
async function loadTransferGraph(): Promise<TransferGraphData> {
  const text = await fs.readFile(getDataPath('transfer-graph.json'), 'utf-8');
  return JSON.parse(text);
}

/**
 * Load route segments data
 */
async function loadRouteSegments(): Promise<RouteSegmentsData> {
  const text = await fs.readFile(getDataPath('route-segments.json'), 'utf-8');
  return JSON.parse(text);
}

/**
 * Build the transit graph from loaded data
 */
async function buildGraph(): Promise<TransitGraph> {
  console.log('[graph-builder] Building transit graph...');
  const startTime = performance.now();

  // Load all data in parallel
  const [stations, transferData, segmentsData] = await Promise.all([
    loadStations(),
    loadTransferGraph(),
    loadRouteSegments(),
  ]);

  console.log(`[graph-builder] Loaded ${stations.size} stations`);
  console.log(`[graph-builder] Loaded ${transferData.complexes.length} transfer complexes`);
  console.log(`[graph-builder] Loaded ${Object.keys(segmentsData.routes).length} routes`);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const stationToNodes = new Map<string, string[]>();

  // Helper to add a node
  const addNode = (stationId: string, routeId: string): string => {
    const key = nodeKey(stationId, routeId);
    if (!nodes.has(key)) {
      nodes.set(key, { stationId, routeId });

      // Update stationToNodes lookup
      if (!stationToNodes.has(stationId)) {
        stationToNodes.set(stationId, []);
      }
      stationToNodes.get(stationId)!.push(key);
    }
    return key;
  };

  // Helper to add an edge
  const addEdge = (fromKey: string, edge: GraphEdge): void => {
    if (!edges.has(fromKey)) {
      edges.set(fromKey, []);
    }
    edges.get(fromKey)!.push(edge);
  };

  // Step 1: Add ride edges from route segments
  // For each route, create nodes at each station and edges between consecutive stops
  for (const [routeId, routeData] of Object.entries(segmentsData.routes)) {
    for (const [, direction] of Object.entries(routeData.directions)) {
      const { stops, edges: segmentEdges } = direction;

      // Create nodes for all stops on this route
      for (const stopId of stops) {
        addNode(stopId, routeId);
      }

      // Create ride edges between consecutive stops (bidirectional)
      for (const edge of segmentEdges) {
        const fromKey = nodeKey(edge.from, routeId);
        const toKey = nodeKey(edge.to, routeId);

        // Forward edge
        addEdge(fromKey, {
          type: 'ride',
          from: { stationId: edge.from, routeId },
          to: { stationId: edge.to, routeId },
          durationSeconds: edge.seconds,
        });

        // Reverse edge (same duration for simplicity)
        addEdge(toKey, {
          type: 'ride',
          from: { stationId: edge.to, routeId },
          to: { stationId: edge.from, routeId },
          durationSeconds: edge.seconds,
        });
      }
    }
  }

  // Step 2: Add transfer edges from transfer graph
  // For each transfer, create edges between all route combinations at those stations
  for (const transfer of transferData.transfers) {
    const { fromStationId, toStationId, walkTimeSeconds, type, complexId } = transfer;

    // Find all nodes at the from and to stations
    const fromNodes = stationToNodes.get(fromStationId) || [];
    const toNodes = stationToNodes.get(toStationId) || [];

    // Create transfer edges between every combination of routes
    for (const fromKey of fromNodes) {
      const fromNode = nodes.get(fromKey)!;

      for (const toKey of toNodes) {
        const toNode = nodes.get(toKey)!;

        // Skip if same route (no transfer needed, just ride)
        if (fromNode.routeId === toNode.routeId) continue;

        addEdge(fromKey, {
          type: 'transfer',
          from: fromNode,
          to: toNode,
          durationSeconds: walkTimeSeconds,
          transferType: type,
          complexId,
        });
      }
    }
  }

  // Step 3: Add same-station transfers for ALL stations where multiple routes meet
  // This is critical for routes that share tracks (e.g., 2/5 in the Bronx, 4/5 in Manhattan)
  for (const [stationId, nodeKeys] of stationToNodes) {
    if (nodeKeys.length < 2) continue; // No transfers possible at single-route stations

    // Create transfer edges between different routes at the same physical station
    for (let i = 0; i < nodeKeys.length; i++) {
      for (let j = i + 1; j < nodeKeys.length; j++) {
        const nodeA = nodes.get(nodeKeys[i])!;
        const nodeB = nodes.get(nodeKeys[j])!;

        // Skip if same route
        if (nodeA.routeId === nodeB.routeId) continue;

        // Check if this edge already exists from transfer graph (both directions)
        const existingEdgesAB = edges.get(nodeKeys[i]) || [];
        const alreadyHasForward = existingEdgesAB.some(
          e => e.type === 'transfer' &&
               e.to.stationId === nodeB.stationId &&
               e.to.routeId === nodeB.routeId
        );
        const existingEdgesBA = edges.get(nodeKeys[j]) || [];
        const alreadyHasReverse = existingEdgesBA.some(
          e => e.type === 'transfer' &&
               e.to.stationId === nodeA.stationId &&
               e.to.routeId === nodeA.routeId
        );
        if (alreadyHasForward || alreadyHasReverse) continue;

        // Same station = cross-platform or same platform transfer (very quick)
        const walkTime = 30; // 30 seconds for same-station transfer

        addEdge(nodeKeys[i], {
          type: 'transfer',
          from: nodeA,
          to: nodeB,
          durationSeconds: walkTime,
          transferType: 'in-system',
          complexId: `same_station_${stationId}`,
        });

        addEdge(nodeKeys[j], {
          type: 'transfer',
          from: nodeB,
          to: nodeA,
          durationSeconds: walkTime,
          transferType: 'in-system',
          complexId: `same_station_${stationId}`,
        });
      }
    }
  }

  const elapsed = performance.now() - startTime;
  console.log(`[graph-builder] Built graph in ${elapsed.toFixed(0)}ms`);
  console.log(`[graph-builder] Nodes: ${nodes.size}`);
  console.log(`[graph-builder] Total edges: ${Array.from(edges.values()).reduce((sum, e) => sum + e.length, 0)}`);

  return {
    nodes,
    edges,
    stationToNodes,
    stations,
  };
}

/**
 * Get the transit graph (builds lazily on first call)
 */
export async function getTransitGraph(): Promise<TransitGraph> {
  if (graphCache) {
    return graphCache;
  }

  if (!graphPromise) {
    graphPromise = buildGraph().then((graph) => {
      graphCache = graph;
      return graph;
    });
  }

  return graphPromise;
}

/**
 * Clear the graph cache (for testing or hot reload)
 */
export function clearGraphCache(): void {
  graphCache = null;
  graphPromise = null;
}

/**
 * Get all nodes at a station
 */
export function getStationNodes(graph: TransitGraph, stationId: string): GraphNode[] {
  const nodeKeys = graph.stationToNodes.get(stationId) || [];
  return nodeKeys.map((key) => graph.nodes.get(key)!).filter(Boolean);
}

/**
 * Get edges from a node
 */
export function getNodeEdges(graph: TransitGraph, node: GraphNode): GraphEdge[] {
  const key = nodeKey(node.stationId, node.routeId);
  return graph.edges.get(key) || [];
}

/**
 * Check if a station exists in the graph
 */
export function hasStation(graph: TransitGraph, stationId: string): boolean {
  return graph.stationToNodes.has(stationId);
}

/**
 * Get station metadata
 */
export function getStationInfo(
  graph: TransitGraph,
  stationId: string
): { name: string; lat: number; lon: number } | undefined {
  return graph.stations.get(stationId);
}
