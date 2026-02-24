import { NextRequest, NextResponse } from 'next/server';
import { rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/health');
  const limit = checkRateLimit(key, RATE_LIMITS.static);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
  });
}
