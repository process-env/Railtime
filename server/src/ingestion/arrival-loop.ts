/**
 * Arrival Board Computation
 *
 * After each feed cycle, computes per-station arrival boards from the raw
 * feed entities. Only computes for stations that have active WebSocket
 * subscribers (tracked by the /arrivals namespace).
 */
import type { FeedEntity, ArrivalItem } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert ISO time to local HH:MM format (NY timezone).
 */
function toLocalHHMM(iso: string): string | null {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });
  } catch {
    return null;
  }
}

/**
 * Human-readable relative ETA string.
 */
function humanEta(iso: string | null): string {
  if (!iso) return "\u2014"; // em dash
  const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (sec < -30) return `${Math.abs(Math.round(sec / 60))}m ago`;
  if (sec <= 30) return "now";
  const m = Math.floor(sec / 60);
  return m <= 1 ? "1m" : `${m}m`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a map of stopId -> ArrivalItem[] from raw feed entities.
 *
 * This function processes ALL stops found in the feed data. If you only
 * need arrivals for specific stations, pass a `filterStopIds` set to
 * avoid unnecessary work.
 *
 * @param feedEntities - Decoded GTFS-RT feed entities
 * @param filterStopIds - Optional set of stop IDs to compute for. If provided,
 *                         only stop IDs in this set (or whose parent IDs are in
 *                         this set) will be included.
 */
export function computeArrivals(
  feedEntities: FeedEntity[],
  filterStopIds?: Set<string>,
): Map<string, ArrivalItem[]> {
  const byStop = new Map<string, ArrivalItem[]>();
  const now = Date.now();
  const cutoff = now + 20 * 60 * 1000; // next 20 minutes

  for (const ent of feedEntities) {
    const { routeId, tripId, stopUpdates = [] } = ent;

    for (const su of stopUpdates) {
      const tISO = su.arrival?.time || su.departure?.time || null;
      if (!tISO || !su.stopId) continue;

      // If we have a filter, check whether this stop is relevant
      if (filterStopIds) {
        const parentId = su.stopId.replace(/[NS]$/, "");
        if (!filterStopIds.has(su.stopId) && !filterStopIds.has(parentId)) {
          continue;
        }
      }

      const t = new Date(tISO).getTime();
      if (isNaN(t) || t > cutoff) continue; // beyond 20m window
      if (t < now - 60_000) continue; // more than 1m in the past

      const item: ArrivalItem = {
        stopId: su.stopId,
        stopName: su.stopName || null,
        whenISO: tISO,
        whenLocal: toLocalHHMM(tISO),
        in: humanEta(tISO),
        routeId,
        tripId,
        scheduleRelationship: su.scheduleRelationship ?? null,
        meta: {
          arrivalDelay: su.arrival?.delay ?? null,
          departureDelay: su.departure?.delay ?? null,
        },
      };

      if (!byStop.has(su.stopId)) {
        byStop.set(su.stopId, []);
      }
      byStop.get(su.stopId)!.push(item);
    }
  }

  // Sort each stop's list by time, cap to 8 upcoming arrivals
  for (const [stopId, list] of byStop.entries()) {
    list.sort(
      (a, b) =>
        new Date(a.whenISO).getTime() - new Date(b.whenISO).getTime(),
    );
    byStop.set(stopId, list.slice(0, 8));
  }

  return byStop;
}

/**
 * Merge arrival maps from multiple feed groups into a single map.
 * Deduplicates by tripId and re-sorts.
 */
export function mergeArrivalMaps(
  ...maps: Map<string, ArrivalItem[]>[]
): Map<string, ArrivalItem[]> {
  const merged = new Map<string, ArrivalItem[]>();

  for (const map of maps) {
    for (const [stopId, items] of map.entries()) {
      if (!merged.has(stopId)) {
        merged.set(stopId, []);
      }
      merged.get(stopId)!.push(...items);
    }
  }

  // Deduplicate by tripId within each stop, sort, and cap
  for (const [stopId, list] of merged.entries()) {
    const seen = new Set<string>();
    const deduped = list.filter((item) => {
      if (!item.tripId || seen.has(item.tripId)) return false;
      seen.add(item.tripId);
      return true;
    });

    deduped.sort(
      (a, b) =>
        new Date(a.whenISO).getTime() - new Date(b.whenISO).getTime(),
    );

    merged.set(stopId, deduped.slice(0, 8));
  }

  return merged;
}
