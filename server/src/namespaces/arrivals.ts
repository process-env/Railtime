/**
 * /arrivals Socket.IO Namespace
 *
 * Per-station arrival board subscriptions. Only computes and broadcasts
 * arrivals for stations that have at least one active subscriber.
 *
 * Rooms:
 *   - "station:{stationId}"  per-station subscription
 *
 * Client events:
 *   - subscribe:station     join station:{stationId}
 *   - unsubscribe:station   leave station:{stationId}
 *
 * Server broadcasts:
 *   - arrivals:update  { stationId, arrivals, updatedAt }
 */
import type { Server, Namespace, Socket } from "socket.io";
import type { FeedEntity } from "../types.js";
import {
  computeArrivals,
  mergeArrivalMaps,
} from "../ingestion/arrival-loop.js";

let arrivalsNsp: Namespace | null = null;

/**
 * Track which station IDs have subscribers so we can skip computation
 * for stations nobody is watching.
 */
const subscriberCount = new Map<string, number>();

function incrementSubscriber(stationId: string): void {
  subscriberCount.set(stationId, (subscriberCount.get(stationId) ?? 0) + 1);
}

function decrementSubscriber(stationId: string): void {
  const count = (subscriberCount.get(stationId) ?? 1) - 1;
  if (count <= 0) {
    subscriberCount.delete(stationId);
  } else {
    subscriberCount.set(stationId, count);
  }
}

/**
 * Returns the set of station IDs that currently have at least one subscriber.
 */
export function getSubscribedStationIds(): Set<string> {
  return new Set(subscriberCount.keys());
}

/**
 * Set up the /arrivals namespace on the Socket.IO server.
 */
export function setupArrivalsNamespace(io: Server): void {
  arrivalsNsp = io.of("/arrivals");

  arrivalsNsp.on("connection", (socket: Socket) => {
    console.log(`[/arrivals] client connected: ${socket.id}`);

    // Track which stations this socket is subscribed to for cleanup
    const socketStations = new Set<string>();

    socket.on("subscribe:station", (stationId: string) => {
      if (typeof stationId !== "string" || !stationId.trim()) return;

      const normalizedId = stationId.trim();
      const room = `station:${normalizedId}`;
      socket.join(room);
      socketStations.add(normalizedId);
      incrementSubscriber(normalizedId);
      console.log(`[/arrivals] ${socket.id} joined ${room}`);
    });

    socket.on("unsubscribe:station", (stationId: string) => {
      if (typeof stationId !== "string" || !stationId.trim()) return;

      const normalizedId = stationId.trim();
      const room = `station:${normalizedId}`;
      socket.leave(room);
      if (socketStations.has(normalizedId)) {
        socketStations.delete(normalizedId);
        decrementSubscriber(normalizedId);
      }
      console.log(`[/arrivals] ${socket.id} left ${room}`);
    });

    socket.on("disconnect", (reason) => {
      // Clean up subscriber counts for all stations this socket was watching
      for (const stationId of socketStations) {
        decrementSubscriber(stationId);
      }
      socketStations.clear();
      console.log(`[/arrivals] ${socket.id} disconnected (${reason})`);
    });
  });

  console.log("[/arrivals] Namespace ready");
}

/**
 * Called after each feed cycle with the raw entities for one feed group.
 * Computes arrivals only for stations with active subscribers, then
 * broadcasts to the appropriate station rooms.
 *
 * Call this once per feed group per cycle, or batch all entities and call once.
 */
export function broadcastArrivals(
  feedGroupId: string,
  entities: FeedEntity[],
): void {
  if (!arrivalsNsp) return;

  const subscribedIds = getSubscribedStationIds();
  if (subscribedIds.size === 0) return; // nobody watching

  const arrivalMap = computeArrivals(entities, subscribedIds);
  const updatedAt = new Date().toISOString();

  for (const [stopId, arrivals] of arrivalMap.entries()) {
    // Broadcast to the exact stop ID room
    arrivalsNsp.to(`station:${stopId}`).emit("arrivals:update", {
      stationId: stopId,
      arrivals,
      updatedAt,
    });

    // Also broadcast to the parent station room (stop ID without N/S suffix)
    const parentId = stopId.replace(/[NS]$/, "");
    if (parentId !== stopId) {
      arrivalsNsp.to(`station:${parentId}`).emit("arrivals:update", {
        stationId: parentId,
        arrivals,
        updatedAt,
      });
    }
  }
}

/**
 * Batch broadcast: merges arrival maps from multiple feed groups and
 * broadcasts to all subscribed stations. Use this if you accumulate
 * entities from all feeds before broadcasting.
 */
export function broadcastArrivalsBatch(
  allEntities: Map<string, FeedEntity[]>,
): void {
  if (!arrivalsNsp) return;

  const subscribedIds = getSubscribedStationIds();
  if (subscribedIds.size === 0) return;

  const maps = Array.from(allEntities.values()).map((entities) =>
    computeArrivals(entities, subscribedIds),
  );

  const merged = mergeArrivalMaps(...maps);
  const updatedAt = new Date().toISOString();

  for (const [stopId, arrivals] of merged.entries()) {
    arrivalsNsp.to(`station:${stopId}`).emit("arrivals:update", {
      stationId: stopId,
      arrivals,
      updatedAt,
    });

    const parentId = stopId.replace(/[NS]$/, "");
    if (parentId !== stopId) {
      arrivalsNsp.to(`station:${parentId}`).emit("arrivals:update", {
        stationId: parentId,
        arrivals,
        updatedAt,
      });
    }
  }
}
