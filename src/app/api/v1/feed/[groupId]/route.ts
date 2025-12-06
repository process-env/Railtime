import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/mta';
import { internalError } from '@/lib/api/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params;
    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('nocache') === 'true';

    const feed = await fetchFeed(groupId, { useCache: !noCache });

    return NextResponse.json(feed);
  } catch (error) {
    console.error('Error fetching feed:', error);
    return internalError(error instanceof Error ? error.message : 'Failed to fetch feed');
  }
}
