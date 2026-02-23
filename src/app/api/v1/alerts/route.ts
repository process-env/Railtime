import { NextRequest, NextResponse } from 'next/server';
import { fetchAlerts, filterAlertsByRoutes } from '@/lib/mta';
import { internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

/**
 * GET /api/v1/alerts
 *
 * Fetches all active service alerts for subway routes.
 * Optional query params:
 *   - route: Comma-separated route IDs to filter (e.g., "A,C,E")
 *   - nocache: Set to "true" to bypass cache
 */
export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/alerts');
  const limit = checkRateLimit(key, RATE_LIMITS.search);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('nocache') === 'true';
    const routeFilter = searchParams.get('route');

    let alerts = await fetchAlerts({ useCache: !noCache });

    // Filter by routes if specified
    if (routeFilter) {
      const routeIds = routeFilter.split(',').map((r) => r.trim());
      alerts = filterAlertsByRoutes(alerts, routeIds);
    }

    return NextResponse.json({
      alerts,
      updatedAt: new Date().toISOString(),
      count: alerts.length,
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return internalError('Failed to fetch alerts');
  }
}
