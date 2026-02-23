import { NextRequest, NextResponse } from 'next/server';
import { loadStops, filterStopsByRoute } from '@/lib/mta';
import { apiError, internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string }> }
) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/routes');
  const limit = checkRateLimit(key, RATE_LIMITS.static);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { routeId } = await params;

    if (!routeId) {
      return apiError('BAD_REQUEST', 'Route ID is required');
    }

    const { list } = await loadStops();
    const filtered = filterStopsByRoute(list, routeId);

    // Sort alphabetically by name, then by ID
    filtered.sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) return nameCompare;
      return a.id.localeCompare(b.id);
    });

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Error loading stops for route:', error);
    return internalError('Failed to load stops');
  }
}
