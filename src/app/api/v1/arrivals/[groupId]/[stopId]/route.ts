import { NextRequest, NextResponse } from 'next/server';
import { getArrivalBoard } from '@/lib/mta';
import { internalError, badRequest, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';
import { feedGroupIdSchema, stopIdSchema, validate } from '@/lib/validation/schemas';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; stopId: string }> }
) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/arrivals');
  const limit = checkRateLimit(key, RATE_LIMITS.realtime);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { groupId: rawGroupId, stopId: rawStopId } = await params;

    // Validate path params
    const groupResult = validate(feedGroupIdSchema, rawGroupId);
    if (!groupResult.success) {
      return badRequest(`Invalid groupId: ${groupResult.error}`);
    }
    const stopResult = validate(stopIdSchema, rawStopId);
    if (!stopResult.success) {
      return badRequest(`Invalid stopId: ${stopResult.error}`);
    }

    const groupId = groupResult.data;
    const stopId = stopResult.data;
    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('nocache') === 'true';

    const board = await getArrivalBoard(groupId, stopId, { useCache: !noCache });

    return NextResponse.json(board);
  } catch (error) {
    console.error('Error getting arrivals:', error);
    return internalError('Failed to get arrivals');
  }
}
