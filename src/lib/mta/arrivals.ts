import type { FeedEntity, ArrivalItem, ArrivalBoard } from '@/types/mta';
import { fetchFeed } from './fetch-feed';
import { loadStops } from './load-stops';
import { getCache, setCache } from '../redis';

const BOARD_TTL_SECONDS = 60; // 1 minute for arrival boards

/**
 * Convert ISO time to local HH:MM format (NY timezone).
 */
function toLocalHHMM(iso: string, tz = 'America/New_York'): string | null {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    });
  } catch {
    return null;
  }
}

/**
 * Human-readable ETA string.
 */
function humanEta(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (sec < -30) return `${Math.abs(Math.round(sec / 60))}m ago`;
  if (sec <= 30) return 'now';
  const m = Math.floor(sec / 60);
  return m <= 1 ? '1m' : `${m}m`;
}

/**
 * Build arrival map from feed entities.
 */
export function buildArrivalMap(
  feedEntities: FeedEntity[]
): Map<string, ArrivalItem[]> {
  const byStop = new Map<string, ArrivalItem[]>();
  const now = Date.now();
  const cutoff = now + 20 * 60 * 1000; // next 20 minutes

  for (const ent of feedEntities) {
    const { routeId, tripId, stopUpdates = [] } = ent;

    for (const su of stopUpdates) {
      const tISO = su.arrival?.time || su.departure?.time || null;
      if (!tISO || !su.stopId) continue;

      const t = new Date(tISO).getTime();
      if (isNaN(t) || t > cutoff) continue; // ignore beyond 20m
      if (t < now - 60 * 1000) continue; // skip 1m past

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

  // Sort each stop's list by time and cap to 8 arrivals
  for (const [stopId, list] of byStop.entries()) {
    list.sort(
      (a, b) => new Date(a.whenISO).getTime() - new Date(b.whenISO).getTime()
    );
    byStop.set(stopId, list.slice(0, 8));
  }

  return byStop;
}

interface GetArrivalBoardOptions {
  apiKey?: string | null;
  useCache?: boolean;
}

/**
 * Get the arrival board for a specific stop.
 */
export async function getArrivalBoard(
  groupId: string,
  stopId: string,
  options: GetArrivalBoardOptions = {}
): Promise<ArrivalBoard> {
  const { apiKey = null, useCache = true } = options;

  const cacheKey = `board:${groupId}`;

  // Try to get cached board
  let board: Record<string, ArrivalBoard> | null = null;

  if (useCache) {
    board = await getCache<Record<string, ArrivalBoard>>(cacheKey);
  }

  if (!board) {
    // Build fresh from feed
    const feed = await fetchFeed(groupId, { useCache, apiKey });
    const byStop = buildArrivalMap(feed);
    const { dict: stops } = await loadStops();

    board = {};
    for (const [sid, arrivals] of byStop.entries()) {
      board[sid] = {
        stopId: sid,
        stopName: arrivals[0]?.stopName || stops[sid]?.name || sid,
        updatedAt: new Date().toISOString(),
        now: new Date().toISOString(),
        arrivals,
      };
    }

    if (useCache) {
      await setCache(cacheKey, board, BOARD_TTL_SECONDS);
    }
  }

  // Get the single stop response, recalculating ETAs
  let row = board[stopId];

  // If child stop ID (e.g., "101N") not found, try parent ID ("101")
  // MTA GTFS-RT data often uses parent stop IDs
  if (!row && /^[A-Z]?\d+[NS]$/i.test(stopId)) {
    const parentId = stopId.slice(0, -1);
    row = board[parentId];
  }

  if (!row) {
    const { dict: stops } = await loadStops();
    return {
      stopId,
      stopName: stops[stopId]?.name || null,
      updatedAt: null,
      now: new Date().toISOString(),
      arrivals: [],
    };
  }

  return {
    ...row,
    now: new Date().toISOString(),
    arrivals: row.arrivals.map((a) => ({
      ...a,
      in: humanEta(a.whenISO),
      whenLocal: toLocalHHMM(a.whenISO),
    })),
  };
}

/**
 * Get arrivals for a stop from all relevant feed groups.
 */
export async function getArrivalsForStop(
  stopId: string,
  options: GetArrivalBoardOptions = {}
): Promise<ArrivalItem[]> {
  // Determine which feed groups to query based on stop ID
  const allGroups = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];

  const results = await Promise.all(
    allGroups.map(async (groupId) => {
      try {
        const board = await getArrivalBoard(groupId, stopId, options);
        return board.arrivals;
      } catch {
        return [];
      }
    })
  );

  const allArrivals = results.flat();

  // Sort by time and dedupe
  allArrivals.sort(
    (a, b) => new Date(a.whenISO).getTime() - new Date(b.whenISO).getTime()
  );

  // Dedupe by tripId
  const seen = new Set<string>();
  return allArrivals.filter((a) => {
    if (!a.tripId || seen.has(a.tripId)) return false;
    seen.add(a.tripId);
    return true;
  });
}
