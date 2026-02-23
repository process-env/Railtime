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
 *
 * Server broadcasts:
 *   - trains:update   { feedGroupId, trains, updatedAt, stale }
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

      // Instantly emit cached positions so the client doesn't wait for the next feed cycle
      (async () => {
        try {
          const results = await Promise.all(
            FEED_GROUPS.map(async (group) => {
              const positions = await getCachedPositions(group.id);
              return { feedGroupId: group.id, positions };
            })
          );
          for (const { feedGroupId, positions } of results) {
            if (positions?.length) {
              socket.emit("trains:update", {
                feedGroupId,
                trains: positions,
                updatedAt: new Date().toISOString(),
                stale: false,
              });
            }
          }
        } catch (err) {
          log.error({ socketId: socket.id, err: err instanceof Error ? err.message : err }, 'failed to send cached positions');
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

    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, 'client disconnected');
    });
  });

  log.info('namespace ready');

  // Return the callback that the feed loop should call per group
  return onFeedUpdate;
}

/**
 * Callback wired into startFeedLoop(). Called once per feed group per cycle.
 */
function onFeedUpdate(
  feedGroupId: string,
  trains: TrainPosition[],
  removedTripIds: string[],
  _entities: unknown, // we don't use entities here
  latencyMs: number,
  status: "success" | "error" | "timeout",
): void {
  if (!trainsNsp) return;

  const updatedAt = new Date().toISOString();
  const stale = status !== "success";

  // --- Broadcast to all-trains room ---
  const fullPayload = { feedGroupId, trains, updatedAt, stale };
  trainsNsp.to("all-trains").emit("trains:update", fullPayload);

  // --- Broadcast to feed:{groupId} room ---
  trainsNsp.to(`feed:${feedGroupId}`).emit("trains:update", fullPayload);

  // --- Fan out to per-route rooms ---
  // Group trains by routeId for targeted delivery
  const byRoute = new Map<string, TrainPosition[]>();
  for (const t of trains) {
    const key = t.routeId.toUpperCase();
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(t);
  }

  // Find all routes that belong to this feed group
  const feedGroup = FEED_GROUPS.find((g) => g.id === feedGroupId);
  const groupRoutes = feedGroup ? feedGroup.routes.map((r) => r.toUpperCase()) : [];

  for (const routeId of groupRoutes) {
    const routeTrains = byRoute.get(routeId) ?? [];
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
