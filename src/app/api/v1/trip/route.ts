import { NextRequest, NextResponse } from 'next/server';
import { getAlternativeTrips } from '@/lib/trip-planner';
import { badRequest, notFound, internalError } from '@/lib/api/errors';

/**
 * GET /api/v1/trip
 *
 * Find optimal subway routes between two stations.
 *
 * Query params:
 *   - origin: Origin station ID (required)
 *   - destination: Destination station ID (required)
 *   - alternatives: Number of alternative routes to return (default: 3, max: 5)
 *   - maxTransfers: Maximum number of transfers allowed (default: 3)
 *   - avoidRoutes: Comma-separated route IDs to avoid (e.g., "A,C,E")
 *
 * Response:
 * {
 *   trips: TripPlan[],
 *   origin: string,
 *   destination: string,
 *   requestedAt: string
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse required params
    const origin = searchParams.get('origin');
    const destination = searchParams.get('destination');

    if (!origin) {
      return badRequest('Missing required parameter: origin');
    }
    if (!destination) {
      return badRequest('Missing required parameter: destination');
    }
    if (origin === destination) {
      return badRequest('Origin and destination cannot be the same');
    }

    // Parse optional params
    const alternativesParam = searchParams.get('alternatives');
    const alternatives = alternativesParam
      ? Math.min(5, Math.max(1, parseInt(alternativesParam, 10)))
      : 3;

    const maxTransfersParam = searchParams.get('maxTransfers');
    const maxTransfers = maxTransfersParam
      ? Math.min(5, Math.max(0, parseInt(maxTransfersParam, 10)))
      : 3;

    const avoidRoutesParam = searchParams.get('avoidRoutes');
    const avoidRoutes = avoidRoutesParam
      ? avoidRoutesParam.split(',').map((r) => r.trim().toUpperCase())
      : [];

    // Find trips
    const trips = await getAlternativeTrips(origin, destination, alternatives, {
      maxTransfers,
      avoidRoutes,
      preferFewerTransfers: true,
    });

    if (trips.length === 0) {
      return notFound(`No routes found from ${origin} to ${destination}`);
    }

    return NextResponse.json({
      trips,
      origin,
      destination,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[trip-api] Error planning trip:', error);
    return internalError(
      error instanceof Error ? error.message : 'Failed to plan trip'
    );
  }
}
