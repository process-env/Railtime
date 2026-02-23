import { NextRequest, NextResponse } from 'next/server';
import { getStop } from '@/lib/mta';
import { apiError, internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stopId: string }> }
) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/stops');
  const limit = checkRateLimit(key, RATE_LIMITS.static);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { stopId } = await params;

    const stop = await getStop(stopId);

    if (!stop) {
      return apiError('NOT_FOUND', 'Stop not found');
    }

    return NextResponse.json(stop);
  } catch (error) {
    console.error('Error getting stop:', error);
    return internalError('Failed to get stop');
  }
}
