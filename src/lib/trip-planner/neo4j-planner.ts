/**
 * Neo4j Trip Planner — Next.js Side
 *
 * Provides a Neo4j-backed implementation of trip planning that can be
 * called directly from Next.js API routes (running on Vercel / Node).
 * The driver connects to the Neo4j instance on EC2.
 *
 * This module mirrors the types from ./types.ts so the output is
 * drop-in compatible with the in-memory Dijkstra planner.
 */

import neo4j, { type Driver, type Session } from 'neo4j-driver';
import type { TripPlan, TripSegment } from './types';

// ---------------------------------------------------------------------------
// Driver singleton
// ---------------------------------------------------------------------------

let driver: Driver | null = null;

function getDriver(): Driver | null {
  if (driver) return driver;

  const uri = process.env.NEO4J_URI;
  if (!uri) return null;

  try {
    driver = neo4j.driver(
      uri,
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? 'neo4j',
        process.env.NEO4J_PASSWORD ?? '',
      ),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 10_000,
        connectionTimeout: 5_000,
      },
    );
    return driver;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cypher queries
// ---------------------------------------------------------------------------

const FIND_PATHS_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  MATCH path = shortestPath((o)-[:CONNECTS_TO*..30]->(d))
  WITH path,
    reduce(cost = 0, r IN relationships(path) | cost + r.duration) AS totalCost,
    size([r IN relationships(path) WHERE r.type = 'transfer']) AS transferCount
  WHERE transferCount <= $maxTransfers
  RETURN path, totalCost, transferCount
  ORDER BY totalCost
  LIMIT $limit
`;

const FIND_PATHS_AVOID_QUERY = `
  MATCH (o:StationRoute) WHERE o.stationId = $originId
  MATCH (d:StationRoute) WHERE d.stationId = $destId
  MATCH path = shortestPath((o)-[:CONNECTS_TO*..30]->(d))
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

const STATION_NAMES_QUERY = `
  MATCH (s:Station) WHERE s.id IN $ids
  RETURN s.id AS id, s.name AS name
`;

// ---------------------------------------------------------------------------
// Neo4j value helpers
// ---------------------------------------------------------------------------

/** Safely coerce a Neo4j Integer (or plain number) to a JS number. */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v) || 0;
}

// ---------------------------------------------------------------------------
// Path -> TripPlan conversion
// ---------------------------------------------------------------------------

interface PathSegment {
  start: { properties: Record<string, unknown> };
  end: { properties: Record<string, unknown> };
  relationship: { properties: Record<string, unknown> };
}

/**
 * Converts a Neo4j path (array of segments) into a TripPlan that is
 * structurally identical to what the in-memory path-converter produces.
 *
 * The algorithm:
 *   1. Walk through path segments in order.
 *   2. Group consecutive "ride" edges on the same route into a single
 *      ride segment, preceded by a "board" segment.
 *   3. Emit "transfer" segments when the edge type is "transfer".
 *   4. Append an "exit" segment at the destination.
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

  const name = (id: string) => stationNames.get(id) ?? id;

  // Ride-grouping state
  let currentRouteId: string | null = null;
  let rideStartStationId: string | null = null;
  let rideDuration = 0;
  let rideStopCount = 0;

  function flushRide(endStationId: string): void {
    if (!currentRouteId || !rideStartStationId) return;

    segments.push({
      type: 'ride',
      routeId: currentRouteId,
      fromStation: { id: rideStartStationId, name: name(rideStartStationId) },
      toStation: { id: endStationId, name: name(endStationId) },
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

        // Emit board segment
        routesUsed.add(routeId);
        segments.push({
          type: 'board',
          routeId,
          fromStation: { id: fromStationId, name: name(fromStationId) },
          toStation: { id: fromStationId, name: name(fromStationId) },
          durationSeconds: 0,
        });

        currentRouteId = routeId;
        rideStartStationId = fromStationId;
        rideDuration = 0;
        rideStopCount = 0;
      }

      rideDuration += duration;
      rideStopCount++;

      // Flush on last segment
      if (i === pathSegments.length - 1) {
        flushRide(toStationId);
      }
    } else if (edgeType === 'transfer') {
      // Flush any ongoing ride before the transfer
      if (currentRouteId) {
        flushRide(fromStationId);
      }

      // Skip trailing transfer that just lands at destination
      const isLast = i === pathSegments.length - 1;
      if (isLast && toStationId === destStationId) {
        totalWalkingSeconds += duration;
        continue;
      }

      totalWalkingSeconds += duration;

      // Classify transfer type based on the edge's actual duration.
      // Previously this read relProps.walkTime which may not exist on
      // every relationship, causing all transfers to default to in-system.
      // Using relProps.duration (always present) gives correct classification:
      //   <= 120s  → in-system (cross-platform / stairway)
      //   > 120s   → out-of-system (street-level walk between stations)
      const transferDuration = toNumber(relProps.duration);
      const transferType: 'in-system' | 'out-of-system' =
        transferDuration > 120 ? 'out-of-system' : 'in-system';

      segments.push({
        type: 'transfer',
        fromStation: { id: fromStationId, name: name(fromStationId) },
        toStation: { id: toStationId, name: name(toStationId) },
        durationSeconds: duration,
        transferType,
      });
    }
  }

  // Determine actual final station
  const lastSeg = pathSegments[pathSegments.length - 1];
  const finalStationId = lastSeg.end.properties.stationId as string;

  // Exit segment
  segments.push({
    type: 'exit',
    fromStation: { id: finalStationId, name: name(finalStationId) },
    toStation: { id: finalStationId, name: name(finalStationId) },
    durationSeconds: 0,
  });

  return {
    id: `trip-${originStationId}-${destStationId}-${index}`,
    origin: { id: originStationId, name: name(originStationId) },
    destination: { id: finalStationId, name: name(finalStationId) },
    segments,
    totalDurationSeconds: toNumber(totalCost),
    totalTransfers: toNumber(transferCount),
    totalWalkingSeconds,
    routes: Array.from(routesUsed),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find optimal trips between two stations using Neo4j's shortestPath.
 *
 * Returns an array of deduplicated TripPlans sorted by travel time,
 * or **null** when Neo4j is not configured / unreachable — the caller
 * should fall back to the in-memory Dijkstra planner.
 */
export async function findTripsNeo4j(
  originStationId: string,
  destStationId: string,
  options: {
    alternatives?: number;
    maxTransfers?: number;
    avoidRoutes?: string[];
  } = {},
): Promise<TripPlan[] | null> {
  const d = getDriver();
  if (!d) return null; // Neo4j not configured

  const maxTransfers = options.maxTransfers ?? 3;
  const limit = options.alternatives ?? 3;
  const avoidRoutes = options.avoidRoutes ?? [];

  let session: Session | null = null;
  try {
    session = d.session({ database: 'neo4j' });

    // 1. Run pathfinding query
    const query = avoidRoutes.length > 0 ? FIND_PATHS_AVOID_QUERY : FIND_PATHS_QUERY;
    const params: Record<string, unknown> = {
      originId: originStationId,
      destId: destStationId,
      maxTransfers: neo4j.int(maxTransfers),
      limit: neo4j.int(limit * 4), // over-fetch to allow dedup
    };
    if (avoidRoutes.length > 0) {
      params.avoidRoutes = avoidRoutes;
    }

    const result = await session.run(query, params);

    if (result.records.length === 0) return null;

    // 2. Collect all unique station IDs across all paths
    const stationIds = new Set<string>();
    for (const record of result.records) {
      const path = record.get('path');
      for (const seg of path.segments) {
        stationIds.add((seg.start.properties as Record<string, unknown>).stationId as string);
        stationIds.add((seg.end.properties as Record<string, unknown>).stationId as string);
      }
    }

    // 3. Batch-fetch station names
    const nameResult = await session.run(STATION_NAMES_QUERY, {
      ids: Array.from(stationIds),
    });
    const stationNames = new Map<string, string>();
    for (const rec of nameResult.records) {
      stationNames.set(rec.get('id'), rec.get('name'));
    }

    // 4. Convert each path to a TripPlan
    const trips: TripPlan[] = [];
    for (let i = 0; i < result.records.length; i++) {
      const record = result.records[i];
      const path = record.get('path');
      const totalCost = record.get('totalCost');
      const transferCount = record.get('transferCount');

      const plan = convertPathToTripPlan(
        path.segments as PathSegment[],
        totalCost,
        transferCount,
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

    return uniqueTrips.slice(0, limit);
  } catch (err) {
    console.error('[neo4j-planner] Query failed:', err);
    return null; // Signal caller to fall back to in-memory planner
  } finally {
    if (session) {
      await session.close();
    }
  }
}
