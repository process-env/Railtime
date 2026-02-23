/**
 * MTA GTFS-RT Feed Ingestion Loop
 *
 * Fetches all 8 MTA protobuf feeds every 15 seconds in parallel,
 * decodes them, calculates interpolated train positions, caches in Redis,
 * and invokes the onUpdate callback so namespace handlers can broadcast.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import axios from "axios";
import protobuf from "protobufjs";
import { setCache } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";
import type {
  FeedGroupConfig,
  FeedEntity,
  StopUpdate,
  Stop,
  TrainPosition,
} from "../types.js";

const log = createLogger('feed-loop');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;
const FEED_TIMEOUT_MS = 12_000;
const REDIS_TTL_SECONDS = 30; // slightly longer than poll interval for overlap
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '..', 'public', 'data');

export const FEED_GROUPS: FeedGroupConfig[] = [
  {
    id: "ACE",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
    routes: ["A", "C", "E"],
  },
  {
    id: "BDFM",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
    routes: ["B", "D", "F", "M"],
  },
  {
    id: "G",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    routes: ["G"],
  },
  {
    id: "JZ",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
    routes: ["J", "Z"],
  },
  {
    id: "NQRW",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
    routes: ["N", "Q", "R", "W"],
  },
  {
    id: "L",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
    routes: ["L"],
  },
  {
    id: "SI",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
    routes: ["SI", "SIR"],
  },
  {
    id: "1234567",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
    routes: ["1", "2", "3", "4", "5", "6", "7", "S"],
  },
];

// ---------------------------------------------------------------------------
// Route terminal map (for headsign resolution from direction suffix)
// ---------------------------------------------------------------------------

const ROUTE_TERMINALS: Record<string, { N: string; S: string }> = {
  "1": { N: "Van Cortlandt Park-242 St", S: "South Ferry" },
  "2": { N: "241 St", S: "Flatbush Av-Brooklyn College" },
  "3": { N: "Harlem-148 St", S: "New Lots Av" },
  "4": { N: "Woodlawn", S: "Crown Heights-Utica Av" },
  "5": { N: "Eastchester-Dyre Av", S: "Flatbush Av-Brooklyn College" },
  "6": { N: "Pelham Bay Park", S: "Brooklyn Bridge-City Hall" },
  "6X": { N: "Pelham Bay Park", S: "Brooklyn Bridge-City Hall" },
  "7": { N: "Flushing-Main St", S: "34 St-Hudson Yards" },
  "7X": { N: "Flushing-Main St", S: "34 St-Hudson Yards" },
  J: { N: "Jamaica Center", S: "Broad St" },
  Z: { N: "Jamaica Center", S: "Broad St" },
  L: { N: "8 Av", S: "Canarsie-Rockaway Pkwy" },
  N: { N: "Astoria-Ditmars Blvd", S: "Coney Island-Stillwell Av" },
  Q: { N: "96 St", S: "Coney Island-Stillwell Av" },
  R: { N: "Forest Hills-71 Av", S: "Bay Ridge-95 St" },
  W: { N: "Astoria-Ditmars Blvd", S: "Whitehall St" },
  A: { N: "Inwood-207 St", S: "Far Rockaway/Ozone Park" },
  C: { N: "168 St", S: "Euclid Av" },
  E: { N: "Jamaica Center", S: "World Trade Center" },
  B: { N: "Bedford Park Blvd", S: "Brighton Beach" },
  D: { N: "Norwood-205 St", S: "Coney Island-Stillwell Av" },
  F: { N: "Jamaica-179 St", S: "Coney Island-Stillwell Av" },
  FX: { N: "Jamaica-179 St", S: "Coney Island-Stillwell Av" },
  M: { N: "Forest Hills-71 Av", S: "Middle Village-Metropolitan Av" },
  G: { N: "Court Sq", S: "Church Av" },
  S: { N: "Times Sq-42 St", S: "Grand Central-42 St" },
  FS: { N: "Franklin Av", S: "Prospect Park" },
  GS: { N: "Times Sq-42 St", S: "Grand Central-42 St" },
  H: { N: "Broad Channel", S: "Rockaway Park" },
  SI: { N: "St George", S: "Tottenville" },
};

// ---------------------------------------------------------------------------
// Protobuf schema (loaded once)
// ---------------------------------------------------------------------------

let FeedMessage: protobuf.Type | null = null;

async function loadProtoSchema(): Promise<protobuf.Type> {
  if (FeedMessage) return FeedMessage;

  const protoPath = path.join(DATA_DIR, "gtfs-realtime.proto");
  const root = await protobuf.load(protoPath);
  FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  log.info('protobuf schema loaded');
  return FeedMessage;
}

// ---------------------------------------------------------------------------
// Stops dictionary (loaded once from stops.txt CSV)
// ---------------------------------------------------------------------------

let stopsDict: Record<string, Stop> | null = null;

async function loadStopsDict(): Promise<Record<string, Stop>> {
  if (stopsDict) return stopsDict;

  const stopsPath = path.join(DATA_DIR, "stops.txt");
  const text = await fs.readFile(stopsPath, "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("stops.txt is empty");
  }

  // Parse CSV header
  const headers = parseCSVLine(lines[0]);
  const colIdx = {
    stop_id: headers.indexOf("stop_id"),
    stop_name: headers.indexOf("stop_name"),
    stop_lat: headers.indexOf("stop_lat"),
    stop_lon: headers.indexOf("stop_lon"),
    parent_station: headers.indexOf("parent_station"),
  };

  if (colIdx.stop_id === -1 || colIdx.stop_name === -1) {
    throw new Error("stops.txt missing required columns (stop_id, stop_name)");
  }

  const dict: Record<string, Stop> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= colIdx.stop_id) continue;

    const id = cols[colIdx.stop_id].trim();
    if (!id) continue;

    dict[id] = {
      id,
      name: cols[colIdx.stop_name]?.trim() ?? id,
      lat: parseFloat(cols[colIdx.stop_lat] ?? "0"),
      lon: parseFloat(cols[colIdx.stop_lon] ?? "0"),
      routes: null,
      parent: cols[colIdx.parent_station]?.trim() || null,
    };
  }

  stopsDict = dict;
  log.info({ stops: Object.keys(dict).length }, 'stops dictionary loaded');
  return dict;
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Protobuf decoding -> FeedEntity[]
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number | null | undefined): string | null {
  if (!ts) return null;
  try {
    return new Date(ts * 1000).toISOString();
  } catch {
    return null;
  }
}

async function decodeFeed(buffer: ArrayBuffer): Promise<FeedEntity[]> {
  const schema = await loadProtoSchema();
  let message;
  try {
    message = schema.decode(new Uint8Array(buffer));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed protobuf buffer (${buffer.byteLength} bytes): ${errMsg}`);
  }
  const obj = schema.toObject(message, {
    longs: Number,
    enums: String,
    defaults: true,
  }) as {
    header?: { timestamp?: number };
    entity?: Array<{
      id?: string;
      tripUpdate?: {
        trip?: {
          routeId?: string;
          tripId?: string;
          startDate?: string;
        };
        stopTimeUpdate?: Array<{
          stopId?: string;
          arrival?: { time?: number; delay?: number };
          departure?: { time?: number; delay?: number };
          scheduleRelationship?: string;
        }>;
      };
      vehicle?: {
        vehicle?: { id?: string };
      };
    }>;
  };

  const stops = await loadStopsDict();
  const feedTimestamp = obj.header?.timestamp ?? null;
  const result: FeedEntity[] = [];

  for (const ent of obj.entity ?? []) {
    if (!ent.tripUpdate) continue;

    const tu = ent.tripUpdate;
    const routeId = tu.trip?.routeId || null;
    const tripId = tu.trip?.tripId || null;
    const startDate = tu.trip?.startDate || null;
    const vehicleId = ent.vehicle?.vehicle?.id || null;

    const stopUpdates: StopUpdate[] = [];
    for (const stu of tu.stopTimeUpdate ?? []) {
      const sId = stu.stopId || null;
      stopUpdates.push({
        stopId: sId,
        stopName: (sId && stops[sId]?.name) || null,
        arrival: {
          time: formatTimestamp(stu.arrival?.time),
          delay: stu.arrival?.delay ?? null,
        },
        departure: {
          time: formatTimestamp(stu.departure?.time),
          delay: stu.departure?.delay ?? null,
        },
        scheduleRelationship: stu.scheduleRelationship || null,
      });
    }

    result.push({
      id: ent.id || null,
      routeId,
      tripId,
      startDate,
      vehicleId,
      stopUpdates,
      timestamp: formatTimestamp(feedTimestamp),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Train position interpolation (ported from src/lib/mta/train-positions.ts)
// ---------------------------------------------------------------------------

function getDirectionFromStopId(stopId: string): "N" | "S" | null {
  if (!stopId) return null;
  const last = stopId.slice(-1).toUpperCase();
  if (last === "N") return "N";
  if (last === "S") return "S";
  return null;
}

function resolveHeadsign(
  routeId: string,
  nextStopId: string,
): string {
  const direction = getDirectionFromStopId(nextStopId);
  if (!direction) return "Unknown";

  const terminals = ROUTE_TERMINALS[routeId.toUpperCase()];
  if (!terminals) return direction === "N" ? "Uptown" : "Downtown";
  return terminals[direction];
}

function calculateHeading(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let heading = (Math.atan2(y, x) * 180) / Math.PI;
  heading = (heading + 360) % 360;
  return heading;
}

async function calculateTrainPositions(
  feedEntities: FeedEntity[],
): Promise<TrainPosition[]> {
  const stops = await loadStopsDict();
  const now = Date.now();
  const positions: TrainPosition[] = [];

  for (const entity of feedEntities) {
    const { routeId, tripId, stopUpdates } = entity;
    if (!routeId || !tripId || !stopUpdates || stopUpdates.length < 2) {
      continue;
    }

    // Find the two stops the train is between
    let prevStop: (typeof stopUpdates)[0] | null = null;
    let nextStop: (typeof stopUpdates)[0] | null = null;

    for (let i = 0; i < stopUpdates.length; i++) {
      const su = stopUpdates[i];
      const arrivalTime = su.arrival?.time
        ? new Date(su.arrival.time).getTime()
        : null;

      if (arrivalTime && arrivalTime > now) {
        nextStop = su;
        prevStop = stopUpdates[i - 1] || null;
        break;
      }
    }

    if (!prevStop || !nextStop || !prevStop.stopId || !nextStop.stopId) {
      continue;
    }

    const prevStopData = stops[prevStop.stopId];
    const nextStopData = stops[nextStop.stopId];
    if (!prevStopData || !nextStopData) continue;

    const prevTime = prevStop.departure?.time || prevStop.arrival?.time;
    const nextTime = nextStop.arrival?.time;
    if (!prevTime || !nextTime) continue;

    const prevTimeMs = new Date(prevTime).getTime();
    const nextTimeMs = new Date(nextTime).getTime();
    const totalDuration = nextTimeMs - prevTimeMs;
    if (totalDuration <= 0) continue;

    const elapsed = now - prevTimeMs;
    const progress = Math.max(0, Math.min(1, elapsed / totalDuration));

    const lat =
      prevStopData.lat + (nextStopData.lat - prevStopData.lat) * progress;
    const lon =
      prevStopData.lon + (nextStopData.lon - prevStopData.lon) * progress;

    const heading = calculateHeading(
      prevStopData.lat,
      prevStopData.lon,
      nextStopData.lat,
      nextStopData.lon,
    );

    const headsign = resolveHeadsign(routeId, nextStop.stopId);

    positions.push({
      tripId,
      routeId,
      lat,
      lon,
      heading,
      nextStopId: nextStop.stopId,
      nextStopName: nextStopData.name,
      eta: nextTime,
      headsign,
      prevStopId: prevStop.stopId,
      prevTimeMs,
      nextTimeMs,
    });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Per-feed-group previous trip tracking (for removed train detection)
// ---------------------------------------------------------------------------

const previousTripIds = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// Single feed group fetch + process
// ---------------------------------------------------------------------------

export interface FeedCycleResult {
  feedGroupId: string;
  trains: TrainPosition[];
  entities: FeedEntity[];
  removedTripIds: string[];
  latencyMs: number;
  status: "success" | "error" | "timeout";
  error?: string;
}

async function fetchAndProcessFeed(
  group: FeedGroupConfig,
): Promise<FeedCycleResult> {
  const start = Date.now();
  const feedGroupId = group.id;

  try {
    const apiKey = process.env.MTA_API_KEY;
    const resp = await axios.get(group.url, {
      responseType: "arraybuffer",
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      timeout: FEED_TIMEOUT_MS,
    });

    const entities = await decodeFeed(resp.data);
    const trains = await calculateTrainPositions(entities);

    // Detect removed trains
    const currentTripIds = new Set(trains.map((t) => t.tripId));
    const prevSet = previousTripIds.get(feedGroupId);
    const removedTripIds: string[] = [];

    if (prevSet) {
      for (const id of prevSet) {
        if (!currentTripIds.has(id)) {
          removedTripIds.push(id);
        }
      }
    }
    previousTripIds.set(feedGroupId, currentTripIds);

    // Cache positions in Redis
    await setCache(`feed:${feedGroupId}:positions`, trains, REDIS_TTL_SECONDS);

    // Also cache raw entities for arrival computation
    await setCache(`feed:${feedGroupId}:entities`, entities, REDIS_TTL_SECONDS);

    const latencyMs = Date.now() - start;
    return { feedGroupId, trains, entities, removedTripIds, latencyMs, status: "success" };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      axios.isAxiosError(err) && err.code === "ECONNABORTED";

    log.error({ feedGroupId, err: message }, 'feed fetch error');

    return {
      feedGroupId,
      trains: [],
      entities: [],
      removedTripIds: [],
      latencyMs,
      status: isTimeout ? "timeout" : "error",
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Loop lifecycle
// ---------------------------------------------------------------------------

export type FeedUpdateCallback = (
  feedGroupId: string,
  trains: TrainPosition[],
  removedTripIds: string[],
  entities: FeedEntity[],
  latencyMs: number,
  status: "success" | "error" | "timeout",
) => void;

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Run one full cycle across all 8 feed groups in parallel.
 */
async function runCycle(onUpdate: FeedUpdateCallback): Promise<void> {
  const results = await Promise.all(
    FEED_GROUPS.map((group) => fetchAndProcessFeed(group)),
  );

  for (const r of results) {
    try {
      onUpdate(
        r.feedGroupId,
        r.trains,
        r.removedTripIds,
        r.entities,
        r.latencyMs,
        r.status,
      );
    } catch (err) {
      log.error({ feedGroupId: r.feedGroupId, err: err instanceof Error ? err.message : err }, 'onUpdate callback error');
    }
  }

  const totalTrains = results.reduce((sum, r) => sum + r.trains.length, 0);
  const failed = results.filter((r) => r.status !== "success").length;
  if (failed > 0) {
    log.info({ trains: totalTrains, failed, feeds: results.length }, 'cycle complete');
  } else {
    log.info({ trains: totalTrains, feeds: results.length }, 'cycle complete');
  }
}

/**
 * Start the feed ingestion loop. Runs one cycle immediately, then waits
 * POLL_INTERVAL_MS (15s) AFTER each cycle completes before scheduling the
 * next. This self-scheduling setTimeout pattern prevents overlapping cycles
 * when a feed fetch takes close to the timeout duration.
 */
export function startFeedLoop(onUpdate: FeedUpdateCallback): void {
  if (running) {
    log.warn('already running');
    return;
  }

  running = true;
  log.info({ feeds: FEED_GROUPS.length, intervalMs: POLL_INTERVAL_MS }, 'starting ingestion');

  async function scheduledCycle() {
    await runCycle(onUpdate).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'cycle error'),
    );
    if (loopTimer !== null) {
      loopTimer = setTimeout(scheduledCycle, POLL_INTERVAL_MS);
    }
  }

  // Warm up stops + protobuf on first cycle, then self-schedule
  runCycle(onUpdate)
    .catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'initial cycle error'),
    )
    .finally(() => {
      if (running) {
        loopTimer = setTimeout(scheduledCycle, POLL_INTERVAL_MS);
      }
    });
}

/**
 * Stop the feed ingestion loop.
 */
export function stopFeedLoop(): void {
  if (!running) return;
  running = false;

  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }

  log.info('stopped');
}
