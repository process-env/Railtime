import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed, fetchAllFeeds } from '@/lib/mta/fetch-feed';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { internalError } from '@/lib/api/errors';
import { getCache, setCache } from '@/lib/redis';
import type { TrainPosition } from '@/types/mta';

const FEED_GROUP_IDS = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];
const CACHE_TTL = 30; // seconds
const CACHE_HEADERS = {
  'Cache-Control': 's-maxage=10, stale-while-revalidate=5',
};

/**
 * Try reading pre-computed positions from Redis.
 * The WS server writes these every 15s with key pattern `feed:{groupId}:positions`.
 * Returns null if any group is missing (partial cache = miss).
 */
async function tryRedisCache(groupId: string | null): Promise<TrainPosition[] | null> {
  const groups = groupId ? [groupId] : FEED_GROUP_IDS;
  const results = await Promise.all(
    groups.map((id) => getCache<TrainPosition[]>(`feed:${id}:positions`))
  );
  // If any group returned null, treat as cache miss
  if (results.some((r) => r === null)) return null;
  return results.flat() as TrainPosition[];
}

/**
 * Write positions back to Redis per feed group so subsequent requests hit cache.
 * Runs in background (fire-and-forget) to not delay the response.
 */
function writeBackToCache(positions: TrainPosition[], groupId: string | null): void {
  if (groupId) {
    // Single group fetch — write directly
    setCache(`feed:${groupId}:positions`, positions, CACHE_TTL);
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
      setCache(`feed:${group}:positions`, trains, CACHE_TTL);
    }
  }
}

/** Map route ID to MTA feed group */
function routeToFeedGroup(routeId: string): string | null {
  // Strip express suffix (e.g., 6X → 6, FX → F)
  const upper = routeId.toUpperCase().replace(/X$/, '');
  if (['A', 'C', 'E'].includes(upper)) return 'ACE';
  if (['B', 'D', 'F', 'M'].includes(upper)) return 'BDFM';
  if (upper === 'G') return 'G';
  if (['J', 'Z'].includes(upper)) return 'JZ';
  if (['N', 'Q', 'R', 'W'].includes(upper)) return 'NQRW';
  if (upper === 'L') return 'L';
  if (upper === 'SI' || upper === 'SIR') return 'SI';
  if (['1', '2', '3', '4', '5', '6', '7'].includes(upper)) return '1234567';
  // Shuttles: S/GS → 1234567 (42nd St), FS → ACE (Franklin Ave), H → ACE (Rockaway)
  if (['S', 'GS'].includes(upper)) return '1234567';
  if (['FS', 'H'].includes(upper)) return 'ACE';
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    // Try Redis cache first (pre-computed by WS server or previous request)
    const cached = await tryRedisCache(groupId);
    if (cached) {
      return NextResponse.json(
        { trains: cached, updatedAt: new Date().toISOString(), source: 'cache' },
        { headers: CACHE_HEADERS }
      );
    }

    // Cache miss — fetch from MTA directly
    const feedEntities = groupId
      ? await fetchFeed(groupId)
      : await fetchAllFeeds();

    const positions = await calculateTrainPositions(feedEntities);

    // Write back to Redis for next request (fire-and-forget)
    writeBackToCache(positions, groupId);

    return NextResponse.json(
      { trains: positions, updatedAt: new Date().toISOString(), source: 'mta' },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching trains:', error);
    return internalError(error instanceof Error ? error.message : 'Failed to fetch trains');
  }
}
