import { getCache, setCache, getRedisClient } from './redis.js';

// ---------------------------------------------------------------------------
// Key patterns and TTLs
// ---------------------------------------------------------------------------

export const CACHE_KEYS = {
  // Feed data (written every 15s by ingestion loop)
  feedPositions: (groupId: string) => `feed:${groupId}:positions`,
  feedEntities: (groupId: string) => `feed:${groupId}:entities`,
  feedStatus: (groupId: string) => `feed:${groupId}:status`,

  // Arrival boards (computed from feed data)
  arrivals: (stationId: string) => `arrivals:${stationId}`,

  // Alerts
  alertsAll: 'alerts:all',
  alertsHash: 'alerts:hash',

  // Trip planning (cached results)
  trip: (origin: string, dest: string, hash: string) => `trip:${origin}:${dest}:${hash}`,

  // Static data (loaded from Neo4j at startup)
  staticStations: 'static:stations',
  staticRoutes: 'static:routes',
} as const;

export const CACHE_TTLS = {
  feedPositions: 15,    // 15 seconds
  feedEntities: 30,     // 30 seconds (kept a bit longer for arrival computation)
  feedStatus: 60,       // 1 minute
  arrivals: 30,         // 30 seconds
  alerts: 60,           // 1 minute
  tripPlan: 300,        // 5 minutes
  staticData: 86400,    // 24 hours
} as const;

// ---------------------------------------------------------------------------
// Cache-aside pattern
// ---------------------------------------------------------------------------

/**
 * Cache-aside: check cache first, call fetcher on miss, store result.
 * Returns the data (from cache or freshly fetched).
 * If both cache and fetcher fail, returns null.
 */
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options: { bypass?: boolean } = {},
): Promise<T | null> {
  // Check cache unless bypass requested
  if (!options.bypass) {
    const cached = await getCache<T>(key);
    if (cached !== null) return cached;
  }

  try {
    const data = await fetcher();
    await setCache(key, data, ttlSeconds);
    return data;
  } catch (err) {
    console.error(`[cache] Fetch failed for key ${key}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

import type { TrainPosition, ServiceAlert, ArrivalItem } from '../types.js';

/** Cache train positions for a feed group */
export async function cachePositions(groupId: string, positions: TrainPosition[]): Promise<void> {
  await setCache(CACHE_KEYS.feedPositions(groupId), positions, CACHE_TTLS.feedPositions);
}

/** Get cached train positions for a feed group */
export async function getCachedPositions(groupId: string): Promise<TrainPosition[] | null> {
  return getCache<TrainPosition[]>(CACHE_KEYS.feedPositions(groupId));
}

/** Cache arrival board for a station */
export async function cacheArrivals(stationId: string, arrivals: ArrivalItem[]): Promise<void> {
  await setCache(CACHE_KEYS.arrivals(stationId), arrivals, CACHE_TTLS.arrivals);
}

/** Get cached arrivals for a station */
export async function getCachedArrivals(stationId: string): Promise<ArrivalItem[] | null> {
  return getCache<ArrivalItem[]>(CACHE_KEYS.arrivals(stationId));
}

/** Cache alerts */
export async function cacheAlerts(alerts: ServiceAlert[]): Promise<void> {
  await setCache(CACHE_KEYS.alertsAll, alerts, CACHE_TTLS.alerts);
}

/** Get cached alerts */
export async function getCachedAlerts(): Promise<ServiceAlert[] | null> {
  return getCache<ServiceAlert[]>(CACHE_KEYS.alertsAll);
}

/** Cache a trip plan result */
export async function cacheTripPlan(origin: string, dest: string, hash: string, data: unknown): Promise<void> {
  await setCache(CACHE_KEYS.trip(origin, dest, hash), data, CACHE_TTLS.tripPlan);
}

/** Cache feed status */
export async function cacheFeedStatus(groupId: string, status: Record<string, unknown>): Promise<void> {
  await setCache(CACHE_KEYS.feedStatus(groupId), status, CACHE_TTLS.feedStatus);
}

/** Get Redis memory info (for monitoring) */
export async function getMemoryInfo(): Promise<{ usedMemory: string; maxMemory: string } | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const info = await client.info('memory');
    const usedMatch = info.match(/used_memory_human:(.+)/);
    const maxMatch = info.match(/maxmemory_human:(.+)/);
    return {
      usedMemory: usedMatch?.[1]?.trim() ?? 'unknown',
      maxMemory: maxMatch?.[1]?.trim() ?? 'unknown',
    };
  } catch {
    return null;
  }
}
