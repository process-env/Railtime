/**
 * /trains Socket.IO Namespace
 *
 * Handles real-time train position broadcasting with room-based fan-out.
 *
 * Rooms:
 *   - "all-trains"        full map view, receives all position updates
 *   - "route:{routeId}"   only positions for that route
 *   - "feed:{feedGroupId}" positions for an entire feed group
 *
 * Client events:
 *   - subscribe:all       join the all-trains room
 *   - subscribe:route     join route:{id}
 *   - unsubscribe:route   leave route:{id}
 *   - subscribe:viewport  set viewport bounds for adaptive push
 *
 * Server broadcasts:
 *   - trains:update   full payload (legacy / first push)
 *   - trains:delta    { added, updated, removed } (incremental)
 *   - trains:snapshot full snapshot (on reconnect)
 *   - trains:remove   { tripIds }
 *   - feed:status     { feedGroupId, status, tripCount, latencyMs }
 */
import type { Server, Namespace, Socket } from "socket.io";
import type { TrainPosition } from "../types.js";
import { FEED_GROUPS, type FeedUpdateCallback } from "../ingestion/feed-loop.js";
import { getCachedPositions } from "../lib/cache.js";
import { authMiddleware } from "../lib/auth.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger('ns:trains');

let trainsNsp: Namespace | null = null;

// ---------------------------------------------------------------------------
// Delta compression state
// ---------------------------------------------------------------------------

/** Last emitted positions per feed group for delta computation. */
const lastEmitted = new Map<string, Map<string, TrainPosition>>();

/** Minimum movement in degrees (~50 meters) to consider a train "updated". */
const MOVEMENT_THRESHOLD = 0.0005;

function hasMoved(a: TrainPosition, b: TrainPosition): boolean {
  return (
    Math.abs(a.lat - b.lat) > MOVEMENT_THRESHOLD ||
    Math.abs(a.lon - b.lon) > MOVEMENT_THRESHOLD ||
    a.nextStopId !== b.nextStopId
  );
}

interface DeltaResult {
  added: TrainPosition[];
  updated: TrainPosition[];
  removed: string[];
}

function computeDelta(feedGroupId: string, trains: TrainPosition[]): DeltaResult {
  const prev = lastEmitted.get(feedGroupId) ?? new Map<string, TrainPosition>();
  const added: TrainPosition[] = [];
  const updated: TrainPosition[] = [];
  const removed: string[] = [];

  const current = new Map(trains.map((t) => [t.tripId, t]));

  for (const [id, train] of current) {
    const old = prev.get(id);
    if (!old) {
      added.push(train);
    } else if (hasMoved(old, train)) {
      updated.push(train);
    }
    // If train exists and hasn't moved, skip it (no change to emit)
  }

  for (const id of prev.keys()) {
    if (!current.has(id)) {
      removed.push(id);
    }
  }

  lastEmitted.set(feedGroupId, current);
  return { added, updated, removed };
}

// ---------------------------------------------------------------------------
// Adaptive push frequency state
// ---------------------------------------------------------------------------

interface ViewportState {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

/** Per-socket viewport for adaptive filtering. */
const socketViewports = new Map<string, ViewportState>();

/** Per-socket cycle counter for frequency throttling. */
const socketCycleCounters = new Map<string, number>();

/** Get push interval in cycles based on zoom level. */
function cyclesPerPush(zoom: number): number {
  if (zoom >= 14) return 1;  // every cycle (15s)
  if (zoom >= 12) return 2;  // every 2nd cycle (30s)
  return 4;                   // every 4th cycle (60s)
}

/** Check if a train is within viewport bounds. */
function isInViewport(train: TrainPosition, vp: ViewportState): boolean {
  return (
    train.lat >= vp.south &&
    train.lat <= vp.north &&
    train.lon >= vp.west &&
    train.lon <= vp.east
  );
}

// ---------------------------------------------------------------------------
// Full snapshot for ghost cleanup
// ---------------------------------------------------------------------------

/** Get all current train positions across all feed groups. */
async function getFullSnapshot(): Promise<TrainPosition[]> {
  const results = await Promise.all(
    FEED_GROUPS.map(async (group) => {
      const positions = await getCachedPositions(group.id);
      return positions ?? [];
    })
  );
  return results.flat();
}

// ---------------------------------------------------------------------------
// Namespace setup
// ---------------------------------------------------------------------------

/**
 * Set up the /trains namespace on the Socket.IO server.
 * Returns the onUpdate callback to wire into the feed loop.
 */
export function setupTrainsNamespace(io: Server): FeedUpdateCallback {
  trainsNsp = io.of("/trains");
  trainsNsp.use(authMiddleware);

  trainsNsp.on("connection", (socket: Socket) => {
    log.info({ socketId: socket.id }, 'client connected');

    // --- Subscribe to all trains (full map view) ---
    socket.on("subscribe:all", () => {
      socket.join("all-trains");
      log.debug({ socketId: socket.id, room: 'all-trains' }, 'joined room');

      // Send full snapshot on subscribe (covers reconnection ghost cleanup)
      (async () => {
        try {
          const allTrains = await getFullSnapshot();
          socket.emit("trains:snapshot", {
            trains: allTrains,
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          log.error({ socketId: socket.id, err: err instanceof Error ? err.message : err }, 'failed to send snapshot');
        }
      })();
    });

    // --- Subscribe to a specific route ---
    socket.on("subscribe:route", (routeId: string) => {
      if (typeof routeId !== "string" || !routeId.trim()) return;
      if (routeId.length > 10) {
        log.warn({ socketId: socket.id, length: routeId.length }, 'routeId exceeds max length');
        return;
      }
      const room = `route:${routeId.toUpperCase()}`;
      socket.join(room);
      log.debug({ socketId: socket.id, room }, 'joined room');
    });

    // --- Unsubscribe from a specific route ---
    socket.on("unsubscribe:route", (routeId: string) => {
      if (typeof routeId !== "string" || !routeId.trim()) return;
      if (routeId.length > 10) return;
      const room = `route:${routeId.toUpperCase()}`;
      socket.leave(room);
      log.debug({ socketId: socket.id, room }, 'left room');
    });

    // --- Subscribe with viewport bounds (adaptive push) ---
    socket.on("subscribe:viewport", (bounds: ViewportState) => {
      if (
        typeof bounds !== "object" || !bounds ||
        typeof bounds.north !== "number" ||
        typeof bounds.south !== "number" ||
        typeof bounds.east !== "number" ||
        typeof bounds.west !== "number" ||
        typeof bounds.zoom !== "number"
      ) {
        return;
      }
      socket.join("all-trains"); // Viewport subscribers also get all-trains room
      socketViewports.set(socket.id, bounds);
      socketCycleCounters.set(socket.id, 0);
      log.debug({ socketId: socket.id, zoom: bounds.zoom }, 'viewport updated');
    });

    socket.on("disconnect", (reason) => {
      socketViewports.delete(socket.id);
      socketCycleCounters.delete(socket.id);
      log.info({ socketId: socket.id, reason }, 'client disconnected');
    });
  });

  log.info('namespace ready');

  // Return the callback that the feed loop should call per group
  return onFeedUpdate;
}

// ---------------------------------------------------------------------------
// Feed update callback
// ---------------------------------------------------------------------------

/**
 * Callback wired into startFeedLoop(). Called once per feed group per cycle.
 */
function onFeedUpdate(
  feedGroupId: string,
  trains: TrainPosition[],
  removedTripIds: string[],
  _entities: unknown,
  latencyMs: number,
  status: "success" | "error" | "timeout",
): void {
  if (!trainsNsp) return;

  const updatedAt = new Date().toISOString();
  const stale = status !== "success";

  // Compute delta (only changed trains)
  const delta = computeDelta(feedGroupId, trains);
  const hasDelta = delta.added.length > 0 || delta.updated.length > 0 || delta.removed.length > 0;

  // --- Broadcast to all-trains room ---
  // Send delta to clients that have received at least one full update
  if (hasDelta) {
    const deltaPayload = {
      feedGroupId,
      added: delta.added,
      updated: delta.updated,
      removed: delta.removed,
      updatedAt,
      stale,
    };

    // For viewport-subscribed sockets, filter and throttle
    const allTrainsRoom = trainsNsp.to("all-trains");

    // Broadcast full delta to all-trains room.
    // Note: viewport filtering was removed because a shared socket serves
    // both the map (with viewport) and analytics (needs all trains).
    // Filtering caused the train count to silently shrink over time.
    // Adaptive push *frequency* (throttling) is still applied below.
    const socketsInRoom = trainsNsp.adapter.rooms?.get("all-trains");

    if (socketsInRoom) {
      for (const socketId of socketsInRoom) {
        const vp = socketViewports.get(socketId);

        if (vp) {
          // Adaptive frequency: skip cycles at low zoom
          const counter = (socketCycleCounters.get(socketId) ?? 0) + 1;
          socketCycleCounters.set(socketId, counter);

          const interval = cyclesPerPush(vp.zoom);
          if (counter % interval !== 0) continue; // Skip this cycle
        }

        trainsNsp.to(socketId).emit("trains:delta", deltaPayload);
      }
    } else {
      allTrainsRoom.emit("trains:delta", deltaPayload);
    }
  }

  // --- Broadcast to feed:{groupId} room (no viewport filtering) ---
  if (hasDelta) {
    trainsNsp.to(`feed:${feedGroupId}`).emit("trains:delta", {
      feedGroupId,
      added: delta.added,
      updated: delta.updated,
      removed: delta.removed,
      updatedAt,
      stale,
    });
  }

  // --- Fan out to per-route rooms ---
  const byRoute = new Map<string, TrainPosition[]>();
  for (const t of trains) {
    if (!t.routeId) continue;
    const key = t.routeId.toUpperCase();
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(t);
  }

  const feedGroup = FEED_GROUPS.find((g) => g.id === feedGroupId);
  const groupRoutes = feedGroup ? feedGroup.routes.map((r) => r.toUpperCase()) : [];

  for (const routeId of groupRoutes) {
    const routeTrains = byRoute.get(routeId) ?? [];
    // Route rooms still get full updates (smaller payloads, simpler client logic)
    trainsNsp.to(`route:${routeId}`).emit("trains:update", {
      feedGroupId,
      trains: routeTrains,
      updatedAt,
      stale,
    });
  }

  // --- Broadcast removed trips ---
  if (removedTripIds.length > 0) {
    trainsNsp.to("all-trains").emit("trains:remove", { tripIds: removedTripIds });
  }

  // --- Feed status event ---
  trainsNsp.to("all-trains").emit("feed:status", {
    feedGroupId,
    status,
    tripCount: trains.length,
    latencyMs,
  });
}
