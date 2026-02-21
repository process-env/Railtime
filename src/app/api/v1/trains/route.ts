import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed, fetchAllFeeds } from '@/lib/mta/fetch-feed';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { internalError } from '@/lib/api/errors';
import { getCache } from '@/lib/redis';
import type { TrainPosition } from '@/types/mta';

const FEED_GROUP_IDS = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    // Try Redis cache first (pre-computed by WS server)
    const cached = await tryRedisCache(groupId);
    if (cached) {
      return NextResponse.json({
        trains: cached,
        updatedAt: new Date().toISOString(),
        source: 'cache',
      });
    }

    // Cache miss — fetch from MTA directly
    const feedEntities = groupId
      ? await fetchFeed(groupId)
      : await fetchAllFeeds();

    const positions = await calculateTrainPositions(feedEntities);

    return NextResponse.json({
      trains: positions,
      updatedAt: new Date().toISOString(),
      source: 'mta',
    });
  } catch (error) {
    console.error('Error fetching trains:', error);
    return internalError(error instanceof Error ? error.message : 'Failed to fetch trains');
  }
}
