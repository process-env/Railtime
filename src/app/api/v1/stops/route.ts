import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchStops } from '@/lib/mta';
import { validationError, internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

const searchParamsSchema = z.object({
  query: z
    .string()
    .max(100, 'Query too long')
    .regex(/^[a-zA-Z0-9\s\-'.]*$/, 'Invalid characters in query')
    .optional(),
  route: z
    .string()
    .max(10, 'Route ID too long')
    .regex(/^[A-Z0-9]*$/i, 'Invalid route ID format')
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    // Rate limit check
    const clientId = getClientId(request);
    const key = createRateLimitKey(clientId, '/api/v1/stops');
    const limit = checkRateLimit(key, RATE_LIMITS.search);
    if (!limit.success) {
      return rateLimited(limit.resetIn);
    }

    const { searchParams } = new URL(request.url);
    const rawParams = {
      query: searchParams.get('query') || undefined,
      route: searchParams.get('route') || undefined,
    };

    const result = searchParamsSchema.safeParse(rawParams);
    if (!result.success) {
      return validationError(result.error.issues[0].message);
    }

    const { query, route } = result.data;
    const stops = await searchStops(query, route);

    return NextResponse.json(stops);
  } catch (error) {
    console.error('Error searching stops:', error);
    return internalError('Failed to search stops');
  }
}
