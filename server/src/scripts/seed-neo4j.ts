/**
 * Neo4j Seed Script
 *
 * Seeds the Neo4j database with the full NYC subway transit graph.
 * Reads GTFS static data from public/data/ and creates nodes and
 * relationships that mirror the in-memory graph built by
 * src/lib/trip-planner/graph-builder.ts.
 *
 * Usage:
 *   npx tsx src/scripts/seed-neo4j.ts          # seed (additive)
 *   npx tsx src/scripts/seed-neo4j.ts --clean   # wipe and re-seed
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import neo4j, { type Driver, type Session } from 'neo4j-driver';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), '..', 'public', 'data');
const CLEAN_FLAG = process.argv.includes('--clean');

const BATCH_SIZE = 500;
const SAME_STATION_WALK_SECONDS = 30;

// ---------------------------------------------------------------------------
// Route metadata
// ---------------------------------------------------------------------------

const ROUTE_COLORS: Record<string, string> = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C', '6X': '#00933C',
  '7': '#B933AD', '7X': '#B933AD',
  A: '#2850AD', C: '#2850AD', E: '#2850AD',
  B: '#FF6319', D: '#FF6319', F: '#FF6319', FX: '#FF6319', M: '#FF6319',
  G: '#6CBE45',
  J: '#996633', Z: '#996633',
  L: '#A7A9AC',
  N: '#FCCC0A', Q: '#FCCC0A', R: '#FCCC0A', W: '#FCCC0A',
  S: '#808183', FS: '#808183', GS: '#808183', H: '#808183',
  SI: '#0039A6', SIR: '#0039A6',
};

const YELLOW_ROUTES = new Set(['N', 'Q', 'R', 'W']);

const FEED_GROUPS = [
  { id: 'ACE', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace', routes: ['A', 'C', 'E'] },
  { id: 'BDFM', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm', routes: ['B', 'D', 'F', 'M'] },
  { id: 'G', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g', routes: ['G'] },
  { id: 'JZ', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz', routes: ['J', 'Z'] },
  { id: 'NQRW', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw', routes: ['N', 'Q', 'R', 'W'] },
  { id: 'L', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l', routes: ['L'] },
  { id: 'SI', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si', routes: ['SI', 'SIR'] },
  { id: '1234567', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs', routes: ['1', '2', '3', '4', '5', '6', '7', 'S'] },
];

/** Map routeId -> feedGroupId for quick lookup */
const ROUTE_TO_FEED_GROUP = new Map<string, string>();
for (const fg of FEED_GROUPS) {
  for (const r of fg.routes) {
    ROUTE_TO_FEED_GROUP.set(r, fg.id);
  }
}

// ---------------------------------------------------------------------------
// Type definitions for loaded data
// ---------------------------------------------------------------------------

interface StopRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  locationType: string;
  parentStation: string;
}

interface RouteSegmentsData {
  routes: Record<string, {
    directions: Record<string, {
      stops: string[];
      edges: Array<{ from: string; to: string; seconds: number }>;
    }>;
  }>;
  meta: { generatedAt: string; routeCount: number; totalEdges: number };
}

interface TransferComplex {
  id: string;
  name: string;
  stationIds: string[];
  routes: string[];
  walkTimeSeconds: number;
  type: string;
}

interface Transfer {
  fromStationId: string;
  toStationId: string;
  walkTimeSeconds: number;
  type: string;
  complexId: string;
}

interface TransferGraphData {
  complexes: TransferComplex[];
  transfers: Transfer[];
  meta: { generatedAt: string; complexCount: number; transferCount: number };
}

interface StationRoutesData {
  stationRoutes: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

async function loadStops(): Promise<StopRow[]> {
  const text = await fs.readFile(dataPath('stops.txt'), 'utf-8');
  const lines = text.split('\n').slice(1); // skip header
  const rows: StopRow[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    const id = parts[0]?.trim() ?? '';
    const name = parts[1]?.trim() ?? '';
    const lat = parseFloat(parts[2]);
    const lon = parseFloat(parts[3]);
    const locationType = parts[4]?.trim() ?? '';
    const parentStation = parts[5]?.trim() ?? '';

    if (id && !isNaN(lat) && !isNaN(lon)) {
      rows.push({ id, name, lat, lon, locationType, parentStation });
    }
  }

  return rows;
}

async function loadRouteSegments(): Promise<RouteSegmentsData> {
  const text = await fs.readFile(dataPath('route-segments.json'), 'utf-8');
  return JSON.parse(text);
}

async function loadTransferGraph(): Promise<TransferGraphData> {
  const text = await fs.readFile(dataPath('transfer-graph.json'), 'utf-8');
  return JSON.parse(text);
}

async function loadStationRoutes(): Promise<StationRoutesData> {
  const text = await fs.readFile(dataPath('station-routes.json'), 'utf-8');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Batch helper
// ---------------------------------------------------------------------------

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Neo4j driver setup (standalone, does not use the singleton from lib/neo4j
// because this is a one-shot script that manages its own lifecycle)
// ---------------------------------------------------------------------------

function createDriver(): Driver {
  const uri = process.env.NEO4J_URI;
  if (!uri) {
    console.error('[seed] NEO4J_URI environment variable is not set.');
    process.exit(1);
  }

  const user = process.env.NEO4J_USER ?? 'neo4j';
  const password = process.env.NEO4J_PASSWORD ?? '';

  return neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 10_000,
    connectionTimeout: 5_000,
  });
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

async function cleanDatabase(session: Session): Promise<void> {
  console.log('[seed] Wiping all nodes and relationships...');
  // Use APOC if available, otherwise batch-delete to avoid OOM on large graphs
  await session.run(`
    CALL {
      MATCH (n) DETACH DELETE n
    } IN TRANSACTIONS OF 10000 ROWS
  `);
  console.log('[seed] Database cleaned.');
}

async function createConstraintsAndIndexes(session: Session): Promise<void> {
  console.log('[seed] Creating constraints and indexes...');

  const statements = [
    'CREATE CONSTRAINT station_id IF NOT EXISTS FOR (s:Station) REQUIRE s.id IS UNIQUE',
    'CREATE CONSTRAINT stop_id IF NOT EXISTS FOR (s:Stop) REQUIRE s.id IS UNIQUE',
    'CREATE CONSTRAINT route_id IF NOT EXISTS FOR (r:Route) REQUIRE r.id IS UNIQUE',
    'CREATE CONSTRAINT feed_group_id IF NOT EXISTS FOR (fg:FeedGroup) REQUIRE fg.id IS UNIQUE',
    'CREATE CONSTRAINT complex_id IF NOT EXISTS FOR (c:Complex) REQUIRE c.id IS UNIQUE',
    'CREATE CONSTRAINT station_route_key IF NOT EXISTS FOR (sr:StationRoute) REQUIRE sr.key IS UNIQUE',
    'CREATE INDEX station_route_station IF NOT EXISTS FOR (sr:StationRoute) ON (sr.stationId)',
    'CREATE INDEX station_route_route IF NOT EXISTS FOR (sr:StationRoute) ON (sr.routeId)',
  ];

  for (const stmt of statements) {
    await session.run(stmt);
  }

  // Wait for indexes to come online
  await session.run('CALL db.awaitIndexes(120)');
  console.log('[seed] Constraints and indexes ready.');
}

async function seedStations(session: Session, stops: StopRow[]): Promise<{ stationCount: number; stopCount: number }> {
  const parentStations = stops.filter(s => s.locationType === '1');
  const childStops = stops.filter(s => s.locationType !== '1');

  // -- Stations (parent, location_type=1) -----------------------------------
  console.log(`[seed] Creating ${parentStations.length} Station nodes...`);
  for (const batch of chunks(parentStations, BATCH_SIZE)) {
    const params = batch.map(s => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
    }));
    await session.run(`
      UNWIND $rows AS s
      CREATE (n:Station {
        id: s.id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        location: point({latitude: s.lat, longitude: s.lon})
      })
    `, { rows: params });
  }

  // -- Stops (all rows, including child platforms) --------------------------
  console.log(`[seed] Creating ${childStops.length} Stop nodes...`);
  for (const batch of chunks(childStops, BATCH_SIZE)) {
    const params = batch.map(s => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      parentId: s.parentStation || '',
    }));
    await session.run(`
      UNWIND $rows AS s
      CREATE (n:Stop {
        id: s.id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        parentId: s.parentId
      })
    `, { rows: params });
  }

  // -- AT_STATION relationships (child stop -> parent station) --------------
  console.log('[seed] Creating AT_STATION relationships...');
  const stopsWithParent = childStops.filter(s => s.parentStation);
  for (const batch of chunks(stopsWithParent, BATCH_SIZE)) {
    const params = batch.map(s => ({
      stopId: s.id,
      stationId: s.parentStation,
    }));
    await session.run(`
      UNWIND $rows AS r
      MATCH (stop:Stop {id: r.stopId})
      MATCH (station:Station {id: r.stationId})
      CREATE (stop)-[:AT_STATION]->(station)
    `, { rows: params });
  }

  return { stationCount: parentStations.length, stopCount: childStops.length };
}

async function seedRoutes(session: Session, segmentsData: RouteSegmentsData): Promise<number> {
  // Collect all unique route IDs from route-segments.json
  const routeIds = Object.keys(segmentsData.routes);

  console.log(`[seed] Creating ${routeIds.length} Route nodes...`);
  const routeParams = routeIds.map(id => ({
    id,
    shortName: id,
    color: ROUTE_COLORS[id] ?? '#888888',
    textColor: YELLOW_ROUTES.has(id) ? '#000000' : '#FFFFFF',
    feedGroupId: ROUTE_TO_FEED_GROUP.get(id) ?? '',
  }));

  for (const batch of chunks(routeParams, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS r
      CREATE (n:Route {
        id: r.id,
        shortName: r.shortName,
        color: r.color,
        textColor: r.textColor,
        feedGroupId: r.feedGroupId
      })
    `, { rows: batch });
  }

  return routeIds.length;
}

async function seedFeedGroups(session: Session): Promise<number> {
  console.log(`[seed] Creating ${FEED_GROUPS.length} FeedGroup nodes...`);
  const params = FEED_GROUPS.map(fg => ({ id: fg.id, url: fg.url }));

  await session.run(`
    UNWIND $rows AS fg
    CREATE (n:FeedGroup {id: fg.id, url: fg.url})
  `, { rows: params });

  // -- IN_FEED_GROUP relationships ------------------------------------------
  console.log('[seed] Creating IN_FEED_GROUP relationships...');
  const routeFeedPairs: Array<{ routeId: string; feedGroupId: string }> = [];
  for (const fg of FEED_GROUPS) {
    for (const routeId of fg.routes) {
      routeFeedPairs.push({ routeId, feedGroupId: fg.id });
    }
  }

  await session.run(`
    UNWIND $rows AS r
    MATCH (route:Route {id: r.routeId})
    MATCH (fg:FeedGroup {id: r.feedGroupId})
    CREATE (route)-[:IN_FEED_GROUP]->(fg)
  `, { rows: routeFeedPairs });

  return FEED_GROUPS.length;
}

async function seedComplexes(session: Session, transferData: TransferGraphData): Promise<number> {
  const { complexes } = transferData;

  console.log(`[seed] Creating ${complexes.length} Complex nodes...`);
  const complexParams = complexes.map(c => ({
    id: c.id,
    name: c.name,
    walkTimeSeconds: c.walkTimeSeconds,
    type: c.type,
  }));

  for (const batch of chunks(complexParams, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS c
      CREATE (n:Complex {
        id: c.id,
        name: c.name,
        walkTimeSeconds: c.walkTimeSeconds,
        type: c.type
      })
    `, { rows: batch });
  }

  // -- IN_COMPLEX relationships (station -> complex) ------------------------
  console.log('[seed] Creating IN_COMPLEX relationships...');
  const stationComplexPairs: Array<{ stationId: string; complexId: string }> = [];
  for (const c of complexes) {
    for (const stationId of c.stationIds) {
      stationComplexPairs.push({ stationId, complexId: c.id });
    }
  }

  for (const batch of chunks(stationComplexPairs, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS r
      MATCH (station:Station {id: r.stationId})
      MATCH (complex:Complex {id: r.complexId})
      CREATE (station)-[:IN_COMPLEX]->(complex)
    `, { rows: batch });
  }

  return complexes.length;
}

async function seedStationRouteNodes(
  session: Session,
  segmentsData: RouteSegmentsData,
  stationRoutesData: StationRoutesData,
): Promise<number> {
  // Collect all unique (stationId, routeId) pairs from both data sources
  const keySet = new Set<string>();
  const pairs: Array<{ key: string; stationId: string; routeId: string }> = [];

  const addPair = (stationId: string, routeId: string) => {
    const key = `${stationId}:${routeId}`;
    if (!keySet.has(key)) {
      keySet.add(key);
      pairs.push({ key, stationId, routeId });
    }
  };

  // From route-segments: every stop on every route
  for (const [routeId, routeData] of Object.entries(segmentsData.routes)) {
    for (const direction of Object.values(routeData.directions)) {
      for (const stopId of direction.stops) {
        addPair(stopId, routeId);
      }
    }
  }

  // From station-routes: ensures we capture any station-route pairs not in segments
  for (const [stationId, routes] of Object.entries(stationRoutesData.stationRoutes)) {
    for (const routeId of routes) {
      addPair(stationId, routeId);
    }
  }

  console.log(`[seed] Creating ${pairs.length} StationRoute nodes...`);
  for (const batch of chunks(pairs, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS sr
      CREATE (n:StationRoute {
        key: sr.key,
        stationId: sr.stationId,
        routeId: sr.routeId
      })
    `, { rows: batch });
  }

  return pairs.length;
}

async function seedRideEdges(session: Session, segmentsData: RouteSegmentsData): Promise<number> {
  console.log('[seed] Creating ride CONNECTS_TO edges...');
  let edgeCount = 0;

  // Collect all ride edges (bidirectional)
  const rideEdges: Array<{
    fromKey: string;
    toKey: string;
    duration: number;
    routeId: string;
  }> = [];

  for (const [routeId, routeData] of Object.entries(segmentsData.routes)) {
    for (const direction of Object.values(routeData.directions)) {
      for (const edge of direction.edges) {
        const fromKey = `${edge.from}:${routeId}`;
        const toKey = `${edge.to}:${routeId}`;

        // Forward edge
        rideEdges.push({
          fromKey,
          toKey,
          duration: edge.seconds,
          routeId,
        });

        // Reverse edge
        rideEdges.push({
          fromKey: toKey,
          toKey: fromKey,
          duration: edge.seconds,
          routeId,
        });
      }
    }
  }

  // Deduplicate: the two directions in route-segments may produce identical
  // bidirectional pairs. Use a Set keyed on "from->to" to keep only unique edges.
  const seen = new Set<string>();
  const uniqueEdges: typeof rideEdges = [];
  for (const e of rideEdges) {
    const key = `${e.fromKey}->${e.toKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEdges.push(e);
    }
  }

  console.log(`[seed]   ${uniqueEdges.length} unique ride edges (deduplicated from ${rideEdges.length})`);

  for (const batch of chunks(uniqueEdges, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS e
      MATCH (from:StationRoute {key: e.fromKey})
      MATCH (to:StationRoute {key: e.toKey})
      CREATE (from)-[:CONNECTS_TO {
        duration: e.duration,
        type: 'ride',
        routeId: e.routeId
      }]->(to)
    `, { rows: batch });
    edgeCount += batch.length;
  }

  return edgeCount;
}

async function seedTransferEdges(
  session: Session,
  transferData: TransferGraphData,
  stationRoutesData: StationRoutesData,
): Promise<number> {
  console.log('[seed] Creating transfer CONNECTS_TO edges from transfer-graph.json...');

  // Build a lookup: stationId -> routeIds
  const stationRouteMap = new Map<string, string[]>();
  for (const [stationId, routes] of Object.entries(stationRoutesData.stationRoutes)) {
    stationRouteMap.set(stationId, routes);
  }

  // Track all created transfer edges to avoid duplicating in step 3
  const existingTransferEdges = new Set<string>();

  const transferEdges: Array<{
    fromKey: string;
    toKey: string;
    duration: number;
    complexId: string;
    walkTime: number;
  }> = [];

  for (const transfer of transferData.transfers) {
    const { fromStationId, toStationId, walkTimeSeconds, complexId } = transfer;

    const fromRoutes = stationRouteMap.get(fromStationId) ?? [];
    const toRoutes = stationRouteMap.get(toStationId) ?? [];

    for (const fromRoute of fromRoutes) {
      for (const toRoute of toRoutes) {
        // Skip same route (ride edges handle that)
        if (fromRoute === toRoute) continue;

        const fromKey = `${fromStationId}:${fromRoute}`;
        const toKey = `${toStationId}:${toRoute}`;
        const edgeKey = `${fromKey}->${toKey}`;

        if (existingTransferEdges.has(edgeKey)) continue;
        existingTransferEdges.add(edgeKey);

        transferEdges.push({
          fromKey,
          toKey,
          duration: walkTimeSeconds,
          complexId,
          walkTime: walkTimeSeconds,
        });
      }
    }
  }

  console.log(`[seed]   ${transferEdges.length} complex transfer edges`);

  for (const batch of chunks(transferEdges, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS e
      MATCH (from:StationRoute {key: e.fromKey})
      MATCH (to:StationRoute {key: e.toKey})
      CREATE (from)-[:CONNECTS_TO {
        duration: e.duration,
        type: 'transfer',
        complexId: e.complexId,
        walkTime: e.walkTime
      }]->(to)
    `, { rows: batch });
  }

  // -- Step 3: Same-station transfers (cross-platform, 30s) -----------------
  console.log('[seed] Creating same-station transfer edges (30s cross-platform)...');

  const sameStationEdges: Array<{
    fromKey: string;
    toKey: string;
    duration: number;
    complexId: string;
    walkTime: number;
  }> = [];

  for (const [stationId, routes] of stationRouteMap) {
    if (routes.length < 2) continue;

    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const routeA = routes[i];
        const routeB = routes[j];

        const keyAB = `${stationId}:${routeA}->${stationId}:${routeB}`;
        const keyBA = `${stationId}:${routeB}->${stationId}:${routeA}`;

        // Only create if no complex transfer already exists for this pair
        if (existingTransferEdges.has(keyAB) || existingTransferEdges.has(keyBA)) continue;

        const complexId = `same_station_${stationId}`;

        sameStationEdges.push({
          fromKey: `${stationId}:${routeA}`,
          toKey: `${stationId}:${routeB}`,
          duration: SAME_STATION_WALK_SECONDS,
          complexId,
          walkTime: SAME_STATION_WALK_SECONDS,
        });

        sameStationEdges.push({
          fromKey: `${stationId}:${routeB}`,
          toKey: `${stationId}:${routeA}`,
          duration: SAME_STATION_WALK_SECONDS,
          complexId,
          walkTime: SAME_STATION_WALK_SECONDS,
        });

        existingTransferEdges.add(keyAB);
        existingTransferEdges.add(keyBA);
      }
    }
  }

  console.log(`[seed]   ${sameStationEdges.length} same-station transfer edges`);

  for (const batch of chunks(sameStationEdges, BATCH_SIZE)) {
    await session.run(`
      UNWIND $rows AS e
      MATCH (from:StationRoute {key: e.fromKey})
      MATCH (to:StationRoute {key: e.toKey})
      CREATE (from)-[:CONNECTS_TO {
        duration: e.duration,
        type: 'transfer',
        complexId: e.complexId,
        walkTime: e.walkTime
      }]->(to)
    `, { rows: batch });
  }

  return transferEdges.length + sameStationEdges.length;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyCounts(session: Session): Promise<void> {
  console.log('\n[seed] --- Verification ---');

  const labels = ['Station', 'Stop', 'Route', 'FeedGroup', 'Complex', 'StationRoute'];
  for (const label of labels) {
    const result = await session.run(`MATCH (n:${label}) RETURN count(n) AS cnt`);
    const count = result.records[0]?.get('cnt')?.toNumber() ?? 0;
    console.log(`[seed]   ${label}: ${count} nodes`);
  }

  // Relationship counts
  const relTypes = ['AT_STATION', 'IN_FEED_GROUP', 'IN_COMPLEX', 'CONNECTS_TO'];
  for (const rel of relTypes) {
    const result = await session.run(`MATCH ()-[r:${rel}]->() RETURN count(r) AS cnt`);
    const count = result.records[0]?.get('cnt')?.toNumber() ?? 0;
    console.log(`[seed]   ${rel}: ${count} relationships`);
  }

  // Breakdown of CONNECTS_TO by type
  const rideResult = await session.run(`MATCH ()-[r:CONNECTS_TO {type: 'ride'}]->() RETURN count(r) AS cnt`);
  const rideCount = rideResult.records[0]?.get('cnt')?.toNumber() ?? 0;
  const transferResult = await session.run(`MATCH ()-[r:CONNECTS_TO {type: 'transfer'}]->() RETURN count(r) AS cnt`);
  const transferCount = transferResult.records[0]?.get('cnt')?.toNumber() ?? 0;
  console.log(`[seed]   CONNECTS_TO breakdown: ${rideCount} ride, ${transferCount} transfer`);
}

async function verifyShortestPath(session: Session): Promise<void> {
  console.log('\n[seed] --- Shortest Path Verification ---');
  console.log('[seed] Finding shortest path: Times Sq (127) -> Union Sq (635)...');

  const result = await session.run(`
    MATCH (start:StationRoute)
    WHERE start.stationId = '127'
    WITH collect(start) AS starts
    MATCH (end:StationRoute)
    WHERE end.stationId = '635'
    WITH starts, collect(end) AS ends
    UNWIND starts AS s
    UNWIND ends AS e
    MATCH path = shortestPath((s)-[:CONNECTS_TO*..30]->(e))
    WITH path, reduce(cost = 0, r IN relationships(path) | cost + r.duration) AS totalCost
    ORDER BY totalCost ASC
    LIMIT 1
    RETURN
      [n IN nodes(path) | n.key] AS nodeKeys,
      [r IN relationships(path) | {type: r.type, duration: r.duration, routeId: r.routeId}] AS edges,
      totalCost,
      length(path) AS hops
  `);

  if (result.records.length === 0) {
    console.log('[seed]   No path found (this may indicate a data issue).');
    return;
  }

  const record = result.records[0];
  const nodeKeys: string[] = record.get('nodeKeys');
  const totalCost = record.get('totalCost')?.toNumber?.() ?? record.get('totalCost');
  const hops = record.get('hops')?.toNumber?.() ?? record.get('hops');

  console.log(`[seed]   Path found: ${hops} hops, ${totalCost} seconds (${(totalCost / 60).toFixed(1)} min)`);
  console.log(`[seed]   Nodes: ${nodeKeys.join(' -> ')}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = performance.now();
  console.log('[seed] Neo4j Transit Graph Seeder');
  console.log(`[seed] Data directory: ${DATA_DIR}`);
  console.log(`[seed] Clean mode: ${CLEAN_FLAG ? 'YES' : 'NO'}`);
  console.log('');

  // 1. Load all data files in parallel
  console.log('[seed] Loading data files...');
  const loadStart = performance.now();
  const [stops, segmentsData, transferData, stationRoutesData] = await Promise.all([
    loadStops(),
    loadRouteSegments(),
    loadTransferGraph(),
    loadStationRoutes(),
  ]);
  console.log(`[seed] Data loaded in ${(performance.now() - loadStart).toFixed(0)}ms`);
  console.log(`[seed]   ${stops.length} stop rows`);
  console.log(`[seed]   ${Object.keys(segmentsData.routes).length} routes in segments`);
  console.log(`[seed]   ${transferData.complexes.length} complexes, ${transferData.transfers.length} transfers`);
  console.log(`[seed]   ${Object.keys(stationRoutesData.stationRoutes).length} stations in station-routes`);
  console.log('');

  // 2. Connect to Neo4j
  const driver = createDriver();
  try {
    await driver.verifyConnectivity();
    console.log('[seed] Neo4j connection verified.');
  } catch (err) {
    console.error('[seed] Failed to connect to Neo4j:', err);
    process.exit(1);
  }

  const session = driver.session({ database: 'neo4j' });

  try {
    // 3. Optionally clean the database
    if (CLEAN_FLAG) {
      await cleanDatabase(session);
      console.log('');
    }

    // 4. Create constraints and indexes
    await createConstraintsAndIndexes(session);
    console.log('');

    // 5. Seed nodes
    const { stationCount, stopCount } = await seedStations(session, stops);
    console.log(`[seed] Stations: ${stationCount}, Stops: ${stopCount}`);
    console.log('');

    const routeCount = await seedRoutes(session, segmentsData);
    console.log(`[seed] Routes: ${routeCount}`);
    console.log('');

    const feedGroupCount = await seedFeedGroups(session);
    console.log(`[seed] Feed groups: ${feedGroupCount}`);
    console.log('');

    const complexCount = await seedComplexes(session, transferData);
    console.log(`[seed] Complexes: ${complexCount}`);
    console.log('');

    const stationRouteCount = await seedStationRouteNodes(session, segmentsData, stationRoutesData);
    console.log(`[seed] StationRoute nodes: ${stationRouteCount}`);
    console.log('');

    // 6. Seed relationships
    const rideEdgeCount = await seedRideEdges(session, segmentsData);
    console.log(`[seed] Ride edges: ${rideEdgeCount}`);
    console.log('');

    const transferEdgeCount = await seedTransferEdges(session, transferData, stationRoutesData);
    console.log(`[seed] Transfer edges: ${transferEdgeCount}`);
    console.log('');

    // 7. Verification
    await verifyCounts(session);
    await verifyShortestPath(session);

    const elapsed = performance.now() - startTime;
    console.log(`\n[seed] Seeding complete in ${(elapsed / 1000).toFixed(1)}s`);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
