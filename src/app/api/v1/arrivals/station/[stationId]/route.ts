import { NextRequest, NextResponse } from 'next/server';
import { getArrivalsForStop } from '@/lib/mta';
import { internalError, badRequest, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';
import { stationIdSchema, validate } from '@/lib/validation/schemas';

/**
 * GET /api/v1/arrivals/station/{stationId}
 *
 * Fetches arrivals for both directions (N/S) of a station from all feed groups.
 * This optimizes the client-side code by doing all 8 feed queries server-side
 * instead of requiring 16 separate client requests.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stationId: string }> }
) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/arrivals');
  const limit = checkRateLimit(key, RATE_LIMITS.realtime);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    const { stationId: rawStationId } = await params;

    // Validate stationId path param
    const stationResult = validate(stationIdSchema, rawStationId);
    if (!stationResult.success) {
      return badRequest(`Invalid stationId: ${stationResult.error}`);
    }
    const stationId = stationResult.data;

    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('nocache') === 'true';

    // Query both directions in parallel
    const northStopId = `${stationId}N`;
    const southStopId = `${stationId}S`;

    const [northArrivals, southArrivals] = await Promise.all([
      getArrivalsForStop(northStopId, { useCache: !noCache }),
      getArrivalsForStop(southStopId, { useCache: !noCache }),
    ]);

    // Combine, sort by time, and dedupe by tripId+stopId
    const allArrivals = [...northArrivals, ...southArrivals];
    allArrivals.sort(
      (a, b) => new Date(a.whenISO).getTime() - new Date(b.whenISO).getTime()
    );

    // Dedupe by tripId+stopId
    const seen = new Set<string>();
    const dedupedArrivals = allArrivals.filter((a) => {
      const key = `${a.tripId}-${a.stopId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({
      stationId,
      updatedAt: new Date().toISOString(),
      arrivals: dedupedArrivals,
    });
  } catch (error) {
    console.error('Error getting station arrivals:', error);
    return internalError('Failed to get arrivals');
  }
}
