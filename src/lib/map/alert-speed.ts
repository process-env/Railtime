/**
 * Alert-based speed modulation
 * Adjusts animation speed based on active service alerts
 */

import type { ServiceAlert } from '@/types/mta';

/**
 * Get speed multiplier for a route based on active alerts
 * Returns 0.5-1.0 (lower = slower animation for delays)
 */
export function getRouteSpeedMultiplier(
  alerts: ServiceAlert[],
  routeId: string
): number {
  const routeAlerts = (alerts ?? []).filter(a =>
    (a.affectedRoutes ?? []).some(r => r.toUpperCase() === routeId.toUpperCase())
  );

  if (routeAlerts.length === 0) return 1.0;

  // Find most severe alert
  for (const alert of routeAlerts) {
    const type = (alert.alertType ?? '').toLowerCase();
    if (type.includes('suspension') || type.includes('cancel')) {
      return 0.5; // Major slowdown
    }
  }

  for (const alert of routeAlerts) {
    const type = (alert.alertType ?? '').toLowerCase();
    if (type.includes('delay')) {
      return 0.8; // Moderate slowdown
    }
  }

  for (const alert of routeAlerts) {
    const type = (alert.alertType ?? '').toLowerCase();
    if (type.includes('service change') || type.includes('detour')) {
      return 0.9; // Minor slowdown
    }
  }

  return 1.0; // Normal speed
}

/**
 * Get all speed multipliers for a set of routes
 */
export function getRouteSpeedMultipliers(
  alerts: ServiceAlert[],
  routeIds: string[]
): Map<string, number> {
  const multipliers = new Map<string, number>();
  for (const routeId of routeIds) {
    multipliers.set(routeId, getRouteSpeedMultiplier(alerts, routeId));
  }
  return multipliers;
}
