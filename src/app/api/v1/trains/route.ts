import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed, fetchAllFeeds } from '@/lib/mta/fetch-feed';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { internalError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    // Fetch feed data
    const feedEntities = groupId
      ? await fetchFeed(groupId)
      : await fetchAllFeeds();

    // Calculate positions with headsigns (server-side)
    const positions = await calculateTrainPositions(feedEntities);

    return NextResponse.json({
      trains: positions,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching trains:', error);
    return internalError(error instanceof Error ? error.message : 'Failed to fetch trains');
  }
}
