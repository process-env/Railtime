/**
 * Neo4j Trip Planner Queries
 *
 * Pathfinding queries over the transit graph seeded by seed-neo4j.ts.
 * Uses a three-tier fallback strategy for weighted shortest path:
 *   1. APOC Dijkstra (true weighted shortest path, requires APOC plugin)
 *   2. Cypher variable-length path enumeration with cost scoring
 *   3. BFS shortestPath fallback (fewest hops, original behavior)
 *
 * Graph model:
 *   (:StationRoute {key, stationId, routeId}) -[:CONNECTS_TO {duration, type, routeId, complexId, walkTime}]-> (:StationRoute)
 *   (:Station {id, name, lat, lon})
 */

import neo4j, { type Session } from 'neo4j-driver';
import { withSession } from '../neo4j.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TripSegment {
  type: 'board' | 'ride' | 'transfer' | 'exit';
  routeId?: string;
  fromStation: { id: string; name: string };
  toStation: { id: string; name: string };
  durationSeconds: number;
  stopCount?: number;
  direction?: string;
  transferType?: 'in-system' | 'out-of-system';
}

export interface TripPlan {
  id: string;
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  segments: TripSegment[];
  totalDurationSeconds: number;
  totalTransfers: number;
  totalWalkingSeconds: number;
  routes: string[];
}

// ---------------------------------------------------------------------------
// Cypher queries — Three-tier fallback for weighted shortest path
//
// Tier 1: APOC Dijkstra — true weighted shortest path (requires APOC plugin)
// Tier 2: Cypher variable-length path enumeration with cost scoring
// Tier 3: BFS shortestPath fallback (fewest hops, not lowest cost)
// ---------------------------------------------------------------------------

// --- Tier 1: APOC Dijkstra (weighted shortest path) -------------------------

const WEIGHTED_APOC_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  WITH collect(o) AS origins
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  WITH origins, collect(d) AS dests
  UNWIND origins AS o
  UNWIND dests AS d
  CALL apoc.algo.dijkstra(o, d, 'CONNECTS_TO', 'duration') YIELD path, weight
  WITH path, weight AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

const WEIGHTED_APOC_AVOID_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  WITH collect(o) AS origins
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  WITH origins, collect(d) AS dests
  UNWIND origins AS o
  UNWIND dests AS d
  CALL apoc.algo.dijkstra(o, d, 'CONNECTS_TO', 'duration') YIELD path, weight
  WITH path, weight AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
    AND ALL(r IN relationships(path) WHERE
      CASE WHEN r.type = 'ride'
      THEN NOT r.routeId IN $avoidRoutes
      ELSE true END)
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

// --- Tier 2: Cypher variable-length path with cost scoring ------------------

const WEIGHTED_CYPHER_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  MATCH path = (o)-[:CONNECTS_TO*..50]->(d)
  WITH path,
    reduce(cost = 0, r IN relationships(path) | cost + r.duration) AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

const WEIGHTED_CYPHER_AVOID_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  MATCH path = (o)-[:CONNECTS_TO*..50]->(d)
  WHERE ALL(r IN relationships(path) WHERE
    CASE WHEN r.type = 'ride'
    THEN NOT r.routeId IN $avoidRoutes
    ELSE true END)
  WITH path,
    reduce(cost = 0, r IN relationships(path) | cost + r.duration) AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

// --- Tier 3: BFS shortestPath fallback (fewest hops, original behavior) -----

const FALLBACK_BFS_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  MATCH path = shortestPath((o)-[:CONNECTS_TO*..50]->(d))
  WITH path,
    reduce(cost = 0, r IN relationships(path) | cost + r.duration) AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

const FALLBACK_BFS_AVOID_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  MATCH path = shortestPath((o)-[:CONNECTS_TO*..50]->(d))
  WHERE ALL(r IN relationships(path) WHERE
    CASE WHEN r.type = 'ride'
    THEN NOT r.routeId IN $avoidRoutes
    ELSE true END)
  WITH path,
    reduce(cost = 0, r IN relationships(path) | cost + r.duration) AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

/**
 * Look up station names for a set of station IDs.
 */
const STATION_NAMES_QUERY = `
  MATCH (s:Station) WHERE s.id IN $ids
  RETURN s.id AS id, s.name AS name
`;

// ---------------------------------------------------------------------------
// Path -> TripPlan conversion
// ---------------------------------------------------------------------------

interface PathSegment {
  start: { properties: Record<string, unknown> };
  end: { properties: Record<string, unknown> };
  relationship: { properties: Record<string, unknown> };
}

/**
 * Walk through the Neo4j path segments and produce a user-facing TripPlan.
 *
 * The algorithm groups consecutive "ride" edges that share the same routeId
 * into a single ride segment, inserts "board" at the start of each such
 * group, inserts "transfer" between groups (when the route changes via a
 * transfer edge), and appends an "exit" at the destination.
 */
function convertPathToTripPlan(
  pathSegments: PathSegment[],
  totalCost: number,
  transferCount: number,
  stationNames: Map<string, string>,
  originStationId: string,
  destStationId: string,
  index: number,
): TripPlan | null {
  if (pathSegments.length === 0) return null;

  const segments: TripSegment[] = [];
  const routesUsed = new Set<string>();
  let totalWalkingSeconds = 0;

  // Helpers
  const stationName = (id: string) => stationNames.get(id) ?? id;
  const toNumber = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (v !== null && typeof v === 'object' && 'toNumber' in v) {
      return (v as { toNumber: () => number }).toNumber();
    }
    return Number(v) || 0;
  };

  // State for grouping consecutive ride edges
  let currentRouteId: string | null = null;
  let rideStartStationId: string | null = null;
  let rideDuration = 0;
  let rideStopCount = 0;

  function flushRide(endStationId: string): void {
    if (!currentRouteId || !rideStartStationId) return;

    segments.push({
      type: 'ride',
      routeId: currentRouteId,
      fromStation: { id: rideStartStationId, name: stationName(rideStartStationId) },
      toStation: { id: endStationId, name: stationName(endStationId) },
      durationSeconds: rideDuration,
      stopCount: rideStopCount,
    });

    currentRouteId = null;
    rideStartStationId = null;
    rideDuration = 0;
    rideStopCount = 0;
  }

  for (let i = 0; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    const relProps = seg.relationship.properties;
    const startProps = seg.start.properties;
    const endProps = seg.end.properties;

    const edgeType = relProps.type as string;
    const duration = toNumber(relProps.duration);
    const edgeRouteId = relProps.routeId as string | undefined;

    const fromStationId = startProps.stationId as string;
    const toStationId = endProps.stationId as string;

    if (edgeType === 'ride') {
      const routeId = edgeRouteId ?? (startProps.routeId as string);

      if (currentRouteId !== routeId) {
        // Flush any previous ride group
        if (currentRouteId) {
          flushRide(fromStationId);
        }

        // Board a new train
        routesUsed.add(routeId);
        segments.push({
          type: 'board',
          routeId,
          fromStation: { id: fromStationId, name: stationName(fromStationId) },
          toStation: { id: fromStationId, name: stationName(fromStationId) },
          durationSeconds: 0,
        });

        currentRouteId = routeId;
        rideStartStationId = fromStationId;
        rideDuration = 0;
        rideStopCount = 0;
      }

      rideDuration += duration;
      rideStopCount++;

      // If this is the last segment, flush the ride now
      if (i === pathSegments.length - 1) {
        flushRide(toStationId);
      }
    } else if (edgeType === 'transfer') {
      // Flush any ongoing ride before the transfer
      if (currentRouteId) {
        flushRide(fromStationId);
      }

      // Skip trailing transfer edges that land at the destination
      // (the user is already there; the transfer is just a graph artifact)
      const isLast = i === pathSegments.length - 1;
      if (isLast && toStationId === destStationId) {
        // Still count the walk time but skip emitting a visible transfer segment
        totalWalkingSeconds += duration;
        continue;
      }

      totalWalkingSeconds += duration;

      const walkTime = toNumber(relProps.walkTime);
      const transferType: 'in-system' | 'out-of-system' | undefined =
        walkTime > 120 ? 'out-of-system' : 'in-system';

      segments.push({
        type: 'transfer',
        fromStation: { id: fromStationId, name: stationName(fromStationId) },
        toStation: { id: toStationId, name: stationName(toStationId) },
        durationSeconds: duration,
        transferType,
      });
    }
  }

  // Determine the actual destination station ID from the last path node
  const lastSeg = pathSegments[pathSegments.length - 1];
  const finalStationId = lastSeg.end.properties.stationId as string;

  // Add exit segment
  segments.push({
    type: 'exit',
    fromStation: { id: finalStationId, name: stationName(finalStationId) },
    toStation: { id: finalStationId, name: stationName(finalStationId) },
    durationSeconds: 0,
  });

  const totalDurationSeconds = toNumber(totalCost);

  return {
    id: `trip-${originStationId}-${destStationId}-${index}`,
    origin: { id: originStationId, name: stationName(originStationId) },
    destination: { id: finalStationId, name: stationName(finalStationId) },
    segments,
    totalDurationSeconds,
    totalTransfers: toNumber(transferCount),
    totalWalkingSeconds,
    routes: Array.from(routesUsed),
  };
}

// ---------------------------------------------------------------------------
// Tiered query execution — tries APOC Dijkstra, then Cypher enumeration,
// then BFS fallback. Each tier produces the same (path, totalCost,
// transferCount) result shape so downstream conversion is identical.
// ---------------------------------------------------------------------------

interface QueryResult {
  records: { get: (key: string) => unknown }[];
  tier: 'apoc-dijkstra' | 'cypher-weighted' | 'bfs-fallback';
}

async function runPathfindingWithFallback(
  session: Session,
  params: Record<string, unknown>,
  useAvoidQuery: boolean,
): Promise<QueryResult> {
  // Tier 1: APOC Dijkstra (true weighted shortest path)
  const apocQuery = useAvoidQuery ? WEIGHTED_APOC_AVOID_QUERY : WEIGHTED_APOC_QUERY;
  try {
    const result = await session.run(apocQuery, params);
    if (result.records.length > 0) {
      return { records: result.records, tier: 'apoc-dijkstra' };
    }
  } catch (err) {
    console.warn(
      '[neo4j-planner] APOC Dijkstra unavailable, falling back to Cypher weighted paths:',
      err instanceof Error ? err.message : err,
    );
  }

  // Tier 2: Variable-length path enumeration scored by duration
  const cypherQuery = useAvoidQuery ? WEIGHTED_CYPHER_AVOID_QUERY : WEIGHTED_CYPHER_QUERY;
  try {
    const result = await session.run(cypherQuery, params);
    if (result.records.length > 0) {
      return { records: result.records, tier: 'cypher-weighted' };
    }
  } catch (err) {
    console.warn(
      '[neo4j-planner] Cypher weighted path query failed, falling back to BFS:',
      err instanceof Error ? err.message : err,
    );
  }

  // Tier 3: Original BFS shortestPath (fewest hops)
  const bfsQuery = useAvoidQuery ? FALLBACK_BFS_AVOID_QUERY : FALLBACK_BFS_QUERY;
  const result = await session.run(bfsQuery, params);
  return { records: result.records, tier: 'bfs-fallback' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find optimal paths between two stations using Neo4j.
 *
 * Uses a three-tier query strategy:
 *   1. APOC Dijkstra — true weighted shortest path (requires APOC plugin)
 *   2. Cypher variable-length path enumeration with cost scoring
 *   3. BFS shortestPath fallback (fewest hops, original behavior)
 *
 * Multiple paths are returned because we enumerate all (origin StationRoute,
 * dest StationRoute) pairs. Results are deduplicated by route combination
 * so the user sees meaningfully different alternatives.
 *
 * @returns Array of TripPlan, or null if Neo4j is unavailable.
 */
export async function findTrips(
  originStationId: string,
  destStationId: string,
  options: {
    alternatives?: number;
    maxTransfers?: number;
    avoidRoutes?: string[];
  } = {},
): Promise<TripPlan[] | null> {
  const maxTransfers = options.maxTransfers ?? 3;
  const limit = options.alternatives ?? 3;
  const avoidRoutes = options.avoidRoutes ?? [];

  return withSession(async (session) => {
    // 1. Run pathfinding query with tiered fallback
    const params: Record<string, unknown> = {
      originId: originStationId,
      destId: destStationId,
      maxTransfers: neo4j.int(maxTransfers),
      limit: neo4j.int(limit * 4), // over-fetch to account for dedup
    };
    if (avoidRoutes.length > 0) {
      params.avoidRoutes = avoidRoutes;
    }

    const { records, tier } = await runPathfindingWithFallback(
      session,
      params,
      avoidRoutes.length > 0,
    );

    console.log(
      `[neo4j-planner] ${originStationId} -> ${destStationId}: ${records.length} path(s) via ${tier}`,
    );

    if (records.length === 0) return null;

    // 2. Collect all unique station IDs to look up names
    const stationIds = new Set<string>();
    for (const record of records) {
      const path = record.get('path') as { segments: PathSegment[] };
      for (const seg of path.segments) {
        stationIds.add(seg.start.properties.stationId as string);
        stationIds.add(seg.end.properties.stationId as string);
      }
    }

    // 3. Batch-fetch station names
    const nameResult = await session.run(STATION_NAMES_QUERY, {
      ids: Array.from(stationIds),
    });
    const stationNames = new Map<string, string>();
    for (const rec of nameResult.records) {
      stationNames.set(rec.get('id') as string, rec.get('name') as string);
    }

    // 4. Convert each Neo4j path to a TripPlan
    const trips: TripPlan[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const path = record.get('path') as { segments: PathSegment[] };
      const totalCost = record.get('totalCost');
      const transferCount = record.get('transferCount');

      const plan = convertPathToTripPlan(
        path.segments as PathSegment[],
        totalCost as number,
        transferCount as number,
        stationNames,
        originStationId,
        destStationId,
        i,
      );
      if (plan) trips.push(plan);
    }

    // 5. Deduplicate by route combination
    const seen = new Set<string>();
    const uniqueTrips = trips.filter((trip) => {
      const key = trip.routes.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 6. Trim to requested number of alternatives
    return uniqueTrips.slice(0, limit);
  });
}
