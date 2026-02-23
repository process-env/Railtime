/**
 * /alerts Socket.IO Namespace
 *
 * Broadcasts MTA service alerts with room-based routing.
 *
 * Rooms:
 *   - "all-alerts"       receives every alert update
 *   - "route:{routeId}"  receives only alerts affecting that route
 *
 * Client events:
 *   - subscribe:all        join all-alerts
 *   - subscribe:route      join route:{routeId}
 *   - unsubscribe:route    leave route:{routeId}
 *
 * Server broadcasts:
 *   - alerts:update   { alerts, updatedAt }              full alert list
 *   - alerts:new      { alert }                          one event per newly appeared alert
 *   - alerts:cleared  { alertId }                        one event per cleared alert ID
 */
import type { Server, Namespace, Socket } from "socket.io";
import type { ServiceAlert } from "../types.js";
import type { AlertUpdateCallback } from "../ingestion/alert-loop.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger('ns:alerts');

let alertsNsp: Namespace | null = null;
let previousAlerts = new Map<string, ServiceAlert>();

/**
 * Set up the /alerts namespace on the Socket.IO server.
 * Returns the onUpdate callback to wire into the alert loop.
 */
export function setupAlertsNamespace(io: Server): AlertUpdateCallback {
  alertsNsp = io.of("/alerts");

  alertsNsp.on("connection", (socket: Socket) => {
    log.info({ socketId: socket.id }, 'client connected');

    socket.on("subscribe:all", () => {
      socket.join("all-alerts");
      log.debug({ socketId: socket.id, room: 'all-alerts' }, 'joined room');
    });

    socket.on("subscribe:route", (routeId: string) => {
      if (typeof routeId !== "string" || !routeId.trim()) return;
      const room = `route:${routeId.toUpperCase()}`;
      socket.join(room);
      log.debug({ socketId: socket.id, room }, 'joined room');
    });

    socket.on("unsubscribe:route", (routeId: string) => {
      if (typeof routeId !== "string" || !routeId.trim()) return;
      const room = `route:${routeId.toUpperCase()}`;
      socket.leave(room);
      log.debug({ socketId: socket.id, room }, 'left room');
    });

    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, 'client disconnected');
    });
  });

  log.info('namespace ready');
  return onAlertUpdate;
}

/**
 * Callback wired into startAlertLoop(). Called with the full alert list.
 */
function onAlertUpdate(alerts: ServiceAlert[]): void {
  if (!alertsNsp) return;

  const updatedAt = new Date().toISOString();
  const currentMap = new Map(alerts.map((a) => [a.id, a]));

  // Detect new alerts
  const newAlerts = alerts.filter((a) => !previousAlerts.has(a.id));

  // Detect cleared alerts
  const clearedIds: string[] = [];
  for (const id of previousAlerts.keys()) {
    if (!currentMap.has(id)) clearedIds.push(id);
  }

  previousAlerts = currentMap;

  // --- Broadcast full update to all-alerts ---
  alertsNsp.to("all-alerts").emit("alerts:update", { alerts, updatedAt });

  // --- Broadcast new alerts (one event per alert, matching client contract) ---
  if (newAlerts.length > 0) {
    for (const alert of newAlerts) {
      alertsNsp.to("all-alerts").emit("alerts:new", { alert });

      // Also emit to per-route rooms
      for (const routeId of alert.affectedRoutes) {
        alertsNsp
          .to(`route:${routeId.toUpperCase()}`)
          .emit("alerts:new", { alert });
      }
    }
  }

  // --- Broadcast cleared alerts (one event per ID, matching client contract) ---
  if (clearedIds.length > 0) {
    for (const alertId of clearedIds) {
      alertsNsp.to("all-alerts").emit("alerts:cleared", { alertId });
    }
  }

  // --- Per-route full update ---
  // Group alerts by route
  const byRoute = new Map<string, ServiceAlert[]>();
  for (const alert of alerts) {
    for (const routeId of alert.affectedRoutes) {
      const key = routeId.toUpperCase();
      if (!byRoute.has(key)) byRoute.set(key, []);
      byRoute.get(key)!.push(alert);
    }
  }

  for (const [routeId, routeAlerts] of byRoute.entries()) {
    alertsNsp
      .to(`route:${routeId}`)
      .emit("alerts:update", { alerts: routeAlerts, updatedAt });
  }
}
