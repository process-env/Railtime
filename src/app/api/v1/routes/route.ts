import { NextRequest, NextResponse } from 'next/server';
import { loadRoutes } from '@/lib/mta';
import { internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/routes');
  const limit = checkRateLimit(key, RATE_LIMITS.static);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { list } = await loadRoutes();
    return NextResponse.json(list);
  } catch (error) {
    console.error('Error loading routes:', error);
    return internalError('Failed to load routes');
  }
}
