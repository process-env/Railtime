import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/mta/fetch-feed';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { routeToFeedGroup } from '@/lib/mta/feed-groups';
import { internalError, badRequest, rateLimited } from '@/lib/api/errors';
import { getCache, setCache } from '@/lib/redis';
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
const CACHE_HEADERS = {
  'Cache-Control': 's-maxage=10, stale-while-revalidate=5',
};

/** Possible values for the `source` field in trains API responses. */
type TrainSource = 'mta' | 'cache' | 'partial-cache' | 'partial-stale' | 'stale';

/** Redis key for the stale fallback cache of a feed group. */
function staleCacheKey(groupId: string): string {
  return `feed:${groupId}:positions:stale`;
}

/**
 * Try reading pre-computed positions from Redis for a single feed group.
 * Returns null on cache miss.
 */
async function trySingleGroupCache(groupId: string): Promise<TrainPosition[] | null> {
  return getCache<TrainPosition[]>(`feed:${groupId}:positions`);
}

/**
 * Try reading pre-computed positions from Redis for all feed groups.
 * Returns cached positions and the list of groups that had cache misses,
 * so we only fetch from MTA for the missing groups.
 */
async function tryRedisCachePartial(): Promise<{
  cached: TrainPosition[];
  missingGroups: string[];
}> {
  const results = await Promise.all(
    FEED_GROUP_IDS.map(async (id) => ({
      groupId: id,
      data: await getCache<TrainPosition[]>(`feed:${id}:positions`),
    }))
  );

  const cached: TrainPosition[] = [];
  const missingGroups: string[] = [];

  for (const { groupId, data } of results) {
    if (data) {
      cached.push(...data);
    } else {
      missingGroups.push(groupId);
    }
  }

  return { cached, missingGroups };
}

/**
 * Write positions back to Redis per feed group so subsequent requests hit cache.
 * Runs in background (fire-and-forget) to not delay the response.
 */
function writeBackToCache(positions: TrainPosition[], groupId: string | null): void {
  if (groupId) {
    // Single group fetch — write directly (fresh + stale fallback)
    setCache(`feed:${groupId}:positions`, positions, CACHE_TTL).catch(() => {});
    setCache(staleCacheKey(groupId), positions, STALE_FALLBACK_TTL).catch(() => {});
  } else {
    // All groups — partition positions by feed group and write each
    const byGroup = new Map<string, TrainPosition[]>();
    for (const pos of positions) {
      const group = routeToFeedGroup(pos.routeId);
      if (!group) continue;
      const arr = byGroup.get(group) || [];
      arr.push(pos);
      byGroup.set(group, arr);
    }
    for (const [group, trains] of byGroup) {
      setCache(`feed:${group}:positions`, trains, CACHE_TTL).catch(() => {});
      setCache(staleCacheKey(group), trains, STALE_FALLBACK_TTL).catch(() => {});
    }
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

    // --- Single-group path: simple cache-or-fetch ---
    if (groupId) {
      const cached = await trySingleGroupCache(groupId);
      if (cached) {
        return NextResponse.json(
          { trains: cached, updatedAt: new Date().toISOString(), source: 'cache' },
          { headers: CACHE_HEADERS }
        );
      }

      try {
        const feedEntities = await fetchFeed(groupId);
        const positions = await calculateTrainPositions(feedEntities);
        writeBackToCache(positions, groupId);

        return NextResponse.json(
          { trains: positions, updatedAt: new Date().toISOString(), source: 'mta' },
          { headers: CACHE_HEADERS }
        );
      } catch (err) {
        // MTA fetch failed — try stale fallback
        const stale = await getCache<TrainPosition[]>(staleCacheKey(groupId));
        if (stale) {
          console.warn(`[trains] Using stale fallback for ${groupId} (${stale.length} trains)`);
          return NextResponse.json(
            { trains: stale, updatedAt: new Date().toISOString(), source: 'stale' },
            { headers: CACHE_HEADERS }
          );
        }
        throw err; // No fallback available — let outer catch handle it
      }
    }

    // --- All-groups path: partial cache with selective MTA fetch ---
    const { cached, missingGroups } = await tryRedisCachePartial();

    if (missingGroups.length === 0) {
      // Full cache hit — return immediately
      return NextResponse.json(
        { trains: cached, updatedAt: new Date().toISOString(), source: 'cache' },
        { headers: CACHE_HEADERS }
      );
    }

    // Fetch only the missing groups from MTA, tracking failures
    const failedGroups: string[] = [];
    const freshEntities = (
      await Promise.all(
        missingGroups.map((gid) =>
          fetchFeed(gid).catch((err) => {
            console.error(`Error fetching ${gid}:`, err.message);
            failedGroups.push(gid);
            return [];
          })
        )
      )
    ).flat();

    const freshPositions = await calculateTrainPositions(freshEntities);

    // Write fresh positions back to Redis (fire-and-forget)
    writeBackToCache(freshPositions, null);

    // If any groups failed, try their stale fallback keys
    let staleFallback: TrainPosition[] = [];
    if (failedGroups.length > 0) {
      const fallbacks = await Promise.all(
        failedGroups.map((gid) => getCache<TrainPosition[]>(staleCacheKey(gid)))
      );
      staleFallback = fallbacks.filter((f): f is TrainPosition[] => f !== null).flat();
      if (staleFallback.length > 0) {
        console.warn(`[trains] Using stale fallback for: ${failedGroups.join(', ')} (${staleFallback.length} trains)`);
      }
    }

    // Merge cached + fresh + stale fallback
    const positions = [...cached, ...freshPositions, ...staleFallback];

    const source: TrainSource =
      staleFallback.length > 0 ? 'partial-stale' :
      cached.length > 0 ? 'partial-cache' : 'mta';

    return NextResponse.json(
      { trains: positions, updatedAt: new Date().toISOString(), source },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching trains:', error);
    return internalError('Failed to fetch trains');
  }
}
