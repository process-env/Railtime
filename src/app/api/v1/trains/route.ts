import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/mta/fetch-feed';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { routeToFeedGroup } from '@/lib/mta/feed-groups';
import { internalError, badRequest, rateLimited } from '@/lib/api/errors';
import { getCache, setCache, pipelineGet, acquireLock, releaseLock } from '@/lib/redis';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';
import type { TrainPosition } from '@/types/mta';

const FEED_GROUP_IDS = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];
const CACHE_TTL = 20; // seconds (15s poll cycle + 5s grace)
const STALE_FALLBACK_TTL = 120; // 2 minutes - used when MTA fetch fails
const LOCK_TTL = 10; // seconds - max time to hold fetch lock
const LOCK_WAIT_MS = 500; // wait before re-reading cache after lock miss
const CACHE_HEADERS = {
  'Cache-Control': 's-maxage=10, stale-while-revalidate=5',
};

/** Possible values for the `source` field in trains API responses. */
type TrainSource = 'mta' | 'cache' | 'partial-cache' | 'partial-stale' | 'stale';

/** Cache envelope wraps data with honest timestamps. */
interface CacheEnvelope {
  data: TrainPosition[];
  cachedAt: string;
}

/** Redis key for the stale fallback cache of a feed group. */
function staleCacheKey(groupId: string): string {
  return `feed:${groupId}:positions:stale`;
}

/** Redis key for the fetch lock of a feed group. */
function lockKey(groupId: string): string {
  return `lock:feed:${groupId}:fetch`;
}

/** Create a CacheEnvelope with current timestamp. */
function makeEnvelope(data: TrainPosition[]): CacheEnvelope {
  return { data, cachedAt: new Date().toISOString() };
}

/**
 * Try reading pre-computed positions from Redis for a single feed group.
 * Returns null on cache miss.
 */
async function trySingleGroupCache(groupId: string): Promise<CacheEnvelope | null> {
  return getCache<CacheEnvelope>(`feed:${groupId}:positions`);
}

/**
 * Try reading pre-computed positions from Redis for all feed groups using pipeline.
 * Returns cached positions and the list of groups that had cache misses.
 */
async function tryRedisCachePartial(): Promise<{
  cached: TrainPosition[];
  cachedAt: string | null;
  missingGroups: string[];
}> {
  const keys = FEED_GROUP_IDS.map((id) => `feed:${id}:positions`);
  const results = await pipelineGet<CacheEnvelope>(keys);

  const cached: TrainPosition[] = [];
  const missingGroups: string[] = [];
  let cachedAt: string | null = null;

  for (let i = 0; i < FEED_GROUP_IDS.length; i++) {
    const envelope = results[i];
    if (envelope?.data) {
      cached.push(...envelope.data);
      if (!cachedAt || envelope.cachedAt > cachedAt) {
        cachedAt = envelope.cachedAt;
      }
    } else {
      missingGroups.push(FEED_GROUP_IDS[i]);
    }
  }

  return { cached, cachedAt, missingGroups };
}

/**
 * Write positions back to Redis per feed group wrapped in CacheEnvelope.
 * Runs in background (fire-and-forget) to not delay the response.
 */
function writeBackToCache(positions: TrainPosition[], groupId: string | null): void {
  if (groupId) {
    const env = makeEnvelope(positions);
    setCache(`feed:${groupId}:positions`, env, CACHE_TTL).catch(() => {});
    setCache(staleCacheKey(groupId), env, STALE_FALLBACK_TTL).catch(() => {});
  } else {
    const byGroup = new Map<string, TrainPosition[]>();
    for (const pos of positions) {
      const group = routeToFeedGroup(pos.routeId);
      if (!group) continue;
      const arr = byGroup.get(group) || [];
      arr.push(pos);
      byGroup.set(group, arr);
    }
    for (const [group, trains] of byGroup) {
      const env = makeEnvelope(trains);
      setCache(`feed:${group}:positions`, env, CACHE_TTL).catch(() => {});
      setCache(staleCacheKey(group), env, STALE_FALLBACK_TTL).catch(() => {});
    }
  }
}

/**
 * Fetch a single group from MTA with stampede protection (SETNX lock).
 * Only one concurrent caller fetches; others wait and read from cache.
 */
async function fetchSingleGroupWithLock(groupId: string): Promise<TrainPosition[]> {
  const acquired = await acquireLock(lockKey(groupId), LOCK_TTL);

  if (!acquired) {
    // Another instance is fetching — wait briefly and read from cache
    await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
    const cached = await trySingleGroupCache(groupId);
    if (cached?.data) return cached.data;
    // Cache still empty — fall through to fetch anyway (lock holder may have failed)
  }

  try {
    const feedEntities = await fetchFeed(groupId);
    const positions = await calculateTrainPositions(feedEntities);
    writeBackToCache(positions, groupId);
    return positions;
  } finally {
    if (acquired) releaseLock(lockKey(groupId)).catch(() => {});
  }
}


export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/trains');
  const limit = checkRateLimit(key, RATE_LIMITS.realtime);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    if (groupId && !FEED_GROUP_IDS.includes(groupId.toUpperCase())) {
      return badRequest(`Invalid feed group: ${groupId}. Valid groups: ${FEED_GROUP_IDS.join(', ')}`);
    }

    // --- Single-group path: cache-or-fetch with stampede protection ---
    if (groupId) {
      const cached = await trySingleGroupCache(groupId);
      if (cached?.data) {
        return NextResponse.json(
          { trains: cached.data, updatedAt: cached.cachedAt, source: 'cache' as TrainSource },
          { headers: CACHE_HEADERS }
        );
      }

      try {
        const positions = await fetchSingleGroupWithLock(groupId);

        return NextResponse.json(
          { trains: positions, updatedAt: new Date().toISOString(), source: 'mta' as TrainSource },
          { headers: CACHE_HEADERS }
        );
      } catch (err) {
        // MTA fetch failed — try stale fallback
        const stale = await getCache<CacheEnvelope>(staleCacheKey(groupId));
        if (stale?.data) {
          console.warn(`[trains] Using stale fallback for ${groupId} (${stale.data.length} trains)`);
          return NextResponse.json(
            { trains: stale.data, updatedAt: stale.cachedAt, source: 'stale' as TrainSource },
            { headers: CACHE_HEADERS }
          );
        }
        throw err; // No fallback available — let outer catch handle it
      }
    }

    // --- All-groups path: partial cache with selective MTA fetch ---
    const { cached, cachedAt, missingGroups } = await tryRedisCachePartial();

    if (missingGroups.length === 0) {
      return NextResponse.json(
        { trains: cached, updatedAt: cachedAt, source: 'cache' as TrainSource },
        { headers: CACHE_HEADERS }
      );
    }

    // Fetch only the missing groups from MTA (no per-group lock in all-groups path)
    const failedGroups: string[] = [];
    const freshEntities = (
      await Promise.all(
        missingGroups.map((gid) =>
          fetchFeed(gid).catch((err) => {
            console.error(`Error fetching ${gid}:`, (err as Error).message);
            failedGroups.push(gid);
            return [];
          })
        )
      )
    ).flat();

    const freshPositions = await calculateTrainPositions(freshEntities);

    // Write fresh positions back to Redis (fire-and-forget)
    writeBackToCache(freshPositions, null);

    // If any groups failed, try their stale fallback keys via pipeline
    let staleFallback: TrainPosition[] = [];
    let staleFallbackAt: string | null = null;
    if (failedGroups.length > 0) {
      const staleKeys = failedGroups.map((gid) => staleCacheKey(gid));
      const fallbacks = await pipelineGet<CacheEnvelope>(staleKeys);
      for (const f of fallbacks) {
        if (f?.data) {
          staleFallback.push(...f.data);
          if (!staleFallbackAt || f.cachedAt > staleFallbackAt) {
            staleFallbackAt = f.cachedAt;
          }
        }
      }
      if (staleFallback.length > 0) {
        console.warn(`[trains] Using stale fallback for: ${failedGroups.join(', ')} (${staleFallback.length} trains)`);
      }
    }

    // Merge cached + fresh + stale fallback
    const positions = [...cached, ...freshPositions, ...staleFallback];

    const source: TrainSource =
      staleFallback.length > 0 ? 'partial-stale' :
      cached.length > 0 ? 'partial-cache' : 'mta';

    // Use the most honest updatedAt available
    const updatedAt = source === 'mta'
      ? new Date().toISOString()
      : cachedAt ?? staleFallbackAt ?? new Date().toISOString();

    return NextResponse.json(
      { trains: positions, updatedAt, source },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching trains:', error);
    return internalError('Failed to fetch trains');
  }
}
