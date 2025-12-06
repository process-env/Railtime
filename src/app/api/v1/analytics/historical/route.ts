import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/v1/analytics/historical
 *
 * DISABLED - This endpoint takes 49+ seconds due to schedule lookup
 * Returns empty data immediately for performance
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    trainHistory: [],
    routeBreakdown: [],
    delayDistribution: [],
    delayStats: null,
    impactMetrics: null,
    collectionStats: { totalSnapshots: 0, totalArrivals: 0, totalAlerts: 0 },
    timestamp: new Date().toISOString(),
    disabled: true,
  });
}
