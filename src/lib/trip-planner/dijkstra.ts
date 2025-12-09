/**
 * Dijkstra's Algorithm for Trip Planning
 *
 * Finds the shortest path between two stations in the transit graph,
 * with configurable penalties for transfers.
 */

import type {
  TransitGraph,
  GraphNode,
  GraphEdge,
  PathfindingResult,
  TripPlannerOptions,
} from './types';
import { nodeKey, parseNodeKey } from './types';
import { getStationNodes } from './graph-builder';

/**
 * Priority queue implementation using a binary heap
 */
class PriorityQueue<T> {
  private heap: Array<{ item: T; priority: number }> = [];

  insert(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  extractMin(): T | null {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop()!.item;

    const min = this.heap[0].item;
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return min;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[index].priority) break;
      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.heap[leftChild].priority < this.heap[smallest].priority) {
        smallest = leftChild;
      }
      if (rightChild < length && this.heap[rightChild].priority < this.heap[smallest].priority) {
        smallest = rightChild;
      }
      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

/**
 * Default options for trip planning
 */
const DEFAULT_OPTIONS: Required<TripPlannerOptions> = {
  maxTransfers: 3,
  preferFewerTransfers: true,
  avoidRoutes: [],
  transferPenalty: 300, // 5 minutes
};

/**
 * Calculate the cost of an edge including penalties
 */
function calculateEdgeCost(
  edge: GraphEdge,
  options: Required<TripPlannerOptions>
): number {
  let cost = edge.durationSeconds;

  // Add transfer penalty
  if (edge.type === 'transfer') {
    cost += options.transferPenalty;

    // Additional penalty for out-of-system transfers
    if (edge.transferType === 'out-of-system') {
      cost += 60; // Extra 1 minute
    }
  }

  return cost;
}

/**
 * Find the shortest path using Dijkstra's algorithm
 */
export function findShortestPath(
  graph: TransitGraph,
  originStationId: string,
  destStationId: string,
  options?: TripPlannerOptions
): PathfindingResult | null {
  const opts: Required<TripPlannerOptions> = { ...DEFAULT_OPTIONS, ...options };

  // Get all starting nodes (all routes at origin station)
  const originNodes = getStationNodes(graph, originStationId);
  if (originNodes.length === 0) {
    console.warn(`[dijkstra] No nodes found at origin station: ${originStationId}`);
    return null;
  }

  // Create a set of avoided routes
  const avoidedRoutes = new Set(opts.avoidRoutes.map((r) => r.toUpperCase()));

  // Distance map: nodeKey -> cost
  const dist = new Map<string, number>();

  // Previous map: nodeKey -> { prevKey, edge }
  const prev = new Map<string, { prevKey: string | null; edge: GraphEdge | null }>();

  // Transfer count: nodeKey -> number of transfers to reach this node
  const transferCount = new Map<string, number>();

  // Priority queue
  const pq = new PriorityQueue<string>();

  // Initialize: add all origin nodes with cost 0
  for (const node of originNodes) {
    // Skip avoided routes
    if (avoidedRoutes.has(node.routeId.toUpperCase())) continue;

    const key = nodeKey(node.stationId, node.routeId);
    dist.set(key, 0);
    prev.set(key, { prevKey: null, edge: null });
    transferCount.set(key, 0);
    pq.insert(key, 0);
  }

  // Dijkstra's main loop
  while (!pq.isEmpty()) {
    const currentKey = pq.extractMin()!;
    const currentDist = dist.get(currentKey)!;
    const currentNode = graph.nodes.get(currentKey)!;
    const currentTransfers = transferCount.get(currentKey) || 0;

    // Check if we reached the destination
    if (currentNode.stationId === destStationId) {
      // Reconstruct path
      return reconstructPath(graph, prev, currentKey, currentDist, currentTransfers);
    }

    // Skip if we've found a better path already
    if (currentDist > (dist.get(currentKey) ?? Infinity)) continue;

    // Explore neighbors
    const edges = graph.edges.get(currentKey) || [];
    for (const edge of edges) {
      // Skip avoided routes
      if (avoidedRoutes.has(edge.to.routeId.toUpperCase())) continue;

      // Check transfer limit
      const newTransfers = currentTransfers + (edge.type === 'transfer' ? 1 : 0);
      if (newTransfers > opts.maxTransfers) continue;

      const toKey = nodeKey(edge.to.stationId, edge.to.routeId);
      const edgeCost = calculateEdgeCost(edge, opts);
      const newDist = currentDist + edgeCost;

      // Check if this is a better path
      const existingDist = dist.get(toKey) ?? Infinity;
      if (newDist < existingDist) {
        dist.set(toKey, newDist);
        prev.set(toKey, { prevKey: currentKey, edge });
        transferCount.set(toKey, newTransfers);
        pq.insert(toKey, newDist);
      }
    }
  }

  // No path found
  console.warn(`[dijkstra] No path found from ${originStationId} to ${destStationId}`);
  return null;
}

/**
 * Reconstruct the path from the prev map
 */
function reconstructPath(
  graph: TransitGraph,
  prev: Map<string, { prevKey: string | null; edge: GraphEdge | null }>,
  endKey: string,
  totalCost: number,
  transfers: number
): PathfindingResult {
  const path: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let actualDuration = 0;

  let currentKey: string | null = endKey;
  while (currentKey) {
    const node = graph.nodes.get(currentKey)!;
    path.unshift(node);

    const prevInfo = prev.get(currentKey);
    if (prevInfo?.edge) {
      edges.unshift(prevInfo.edge);
      actualDuration += prevInfo.edge.durationSeconds;
    }
    currentKey = prevInfo?.prevKey ?? null;
  }

  return {
    path,
    edges,
    totalCost,
    actualDuration,
    transferCount: transfers,
  };
}

/**
 * Find multiple alternative paths (k-shortest paths)
 * Uses Yen's algorithm variant
 */
export function findAlternativePaths(
  graph: TransitGraph,
  originStationId: string,
  destStationId: string,
  k: number = 3,
  options?: TripPlannerOptions
): PathfindingResult[] {
  const results: PathfindingResult[] = [];

  // Find the first shortest path
  const firstPath = findShortestPath(graph, originStationId, destStationId, options);
  if (!firstPath) return results;
  results.push(firstPath);

  // Try to find alternative paths by avoiding routes from previous paths
  const usedRoutes = new Set<string>();

  // Collect routes from first path
  for (const node of firstPath.path) {
    usedRoutes.add(node.routeId);
  }

  // Try finding paths avoiding different route combinations
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let i = 1; i < k && usedRoutes.size > 0; i++) {
    // Pick a route to avoid
    const routesArray = Array.from(usedRoutes);
    const routeToAvoid = routesArray[Math.floor(Math.random() * routesArray.length)];
    const avoidRoutes = [...(opts.avoidRoutes || []), routeToAvoid];

    const altPath = findShortestPath(graph, originStationId, destStationId, {
      ...opts,
      avoidRoutes,
    });

    if (altPath) {
      // Check if this is actually a different path
      const pathKey = altPath.path.map((n) => `${n.stationId}:${n.routeId}`).join(',');
      const existingKeys = results.map((r) =>
        r.path.map((n) => `${n.stationId}:${n.routeId}`).join(',')
      );

      if (!existingKeys.includes(pathKey)) {
        results.push(altPath);

        // Add new routes to the set
        for (const node of altPath.path) {
          usedRoutes.add(node.routeId);
        }
      }
    }

    usedRoutes.delete(routeToAvoid);
  }

  // Sort by actual duration (not including penalties)
  results.sort((a, b) => a.actualDuration - b.actualDuration);

  return results.slice(0, k);
}
