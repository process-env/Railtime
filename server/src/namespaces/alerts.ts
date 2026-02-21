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

let alertsNsp: Namespace | null = null;
let previousAlerts = new Map<string, ServiceAlert>();

/**
 * Set up the /alerts namespace on the Socket.IO server.
 * Returns the onUpdate callback to wire into the alert loop.
 */
export function setupAlertsNamespace(io: Server): AlertUpdateCallback {
  alertsNsp = io.of("/alerts");

  alertsNsp.on("connection", (socket: Socket) => {
    console.log(`[/alerts] client connected: ${socket.id}`);

    socket.on("subscribe:all", () => {
      socket.join("all-alerts");
      console.log(`[/alerts] ${socket.id} joined all-alerts`);
    });

    socket.on("subscribe:route", (routeId: string) => {
      if (typeof routeId !== "string" || !routeId.trim()) return;
      const room = `route:${routeId.toUpperCase()}`;
      socket.join(room);
      console.log(`[/alerts] ${socket.id} joined ${room}`);
    });

    socket.on("unsubscribe:route", (routeId: string) => {
      if (typeof routeId !== "string" || !routeId.trim()) return;
      const room = `route:${routeId.toUpperCase()}`;
      socket.leave(room);
      console.log(`[/alerts] ${socket.id} left ${room}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[/alerts] ${socket.id} disconnected (${reason})`);
    });
  });

  console.log("[/alerts] Namespace ready");
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
