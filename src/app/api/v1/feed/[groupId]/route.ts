import { NextRequest, NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/mta';
import { internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/feed');
  const limit = checkRateLimit(key, RATE_LIMITS.realtime);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { groupId } = await params;
    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('nocache') === 'true';

    const feed = await fetchFeed(groupId, { useCache: !noCache });

    return NextResponse.json(feed);
  } catch (error) {
    console.error('Error fetching feed:', error);
    return internalError('Failed to fetch feed');
  }
}
