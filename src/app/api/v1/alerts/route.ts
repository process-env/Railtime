import { NextRequest, NextResponse } from 'next/server';
import { fetchAlerts, filterAlertsByRoutes } from '@/lib/mta';
import { internalError } from '@/lib/api/errors';

/**
 * GET /api/v1/alerts
 *
 * Fetches all active service alerts for subway routes.
 * Optional query params:
 *   - route: Comma-separated route IDs to filter (e.g., "A,C,E")
 *   - nocache: Set to "true" to bypass cache
 */
export async function GET(request: NextRequest) {
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
    return internalError(error instanceof Error ? error.message : 'Failed to fetch alerts');
  }
}
