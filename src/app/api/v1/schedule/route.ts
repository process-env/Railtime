import { NextResponse } from 'next/server';
import { getScheduleStats, getRouteSchedule } from '@/lib/mta/load-stop-times';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/schedule
 * Returns schedule statistics computed from GTFS static data.
 *
 * Query params:
 * - routeId: Optional. If provided, returns stats for specific route only.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routeId = searchParams.get('routeId');

    if (routeId) {
      const routeStats = await getRouteSchedule(routeId);
      if (!routeStats) {
        return NextResponse.json(
          { error: `Route ${routeId} not found` },
          { status: 404 }
        );
      }
      return NextResponse.json(routeStats);
    }

    const scheduleData = await getScheduleStats();
    return NextResponse.json(scheduleData);
  } catch (error) {
    console.error('Error fetching schedule stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedule statistics' },
      { status: 500 }
    );
  }
}
