import { NextRequest, NextResponse } from 'next/server';
import { getAlternativeTrips } from '@/lib/trip-planner';
import { findTripsNeo4j } from '@/lib/trip-planner/neo4j-planner';
import { getCache, setCache } from '@/lib/redis';
import { badRequest, notFound, internalError } from '@/lib/api/errors';

/** Cache TTL for trip results (5 minutes). */
const CACHE_TTL_SECONDS = 300;

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
 *   - nocache: If set, bypass the Redis cache
 *
 * Response:
 * {
 *   trips: TripPlan[],
 *   origin: string,
 *   destination: string,
 *   requestedAt: string,
 *   backend: 'neo4j' | 'in-memory'
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
    const alternativesRaw = alternativesParam !== null ? parseInt(alternativesParam, 10) : NaN;
    const alternatives = Number.isNaN(alternativesRaw)
      ? 3
      : Math.min(5, Math.max(1, alternativesRaw));

    const maxTransfersParam = searchParams.get('maxTransfers');
    const maxTransfersRaw = maxTransfersParam !== null ? parseInt(maxTransfersParam, 10) : NaN;
    const maxTransfers = Number.isNaN(maxTransfersRaw)
      ? 3
      : Math.min(5, Math.max(0, maxTransfersRaw));

    const avoidRoutesParam = searchParams.get('avoidRoutes');
    const avoidRoutes = avoidRoutesParam
      ? avoidRoutesParam.split(',').map((r) => r.trim().toUpperCase())
      : [];

    const noCache = searchParams.has('nocache');

    // --- Redis cache check ---
    const avoidKey = avoidRoutes.length > 0 ? `:avoid=${avoidRoutes.join(',')}` : '';
    const cacheKey = `trip:${origin}:${destination}:${alternatives}:${maxTransfers}${avoidKey}`;

    if (!noCache) {
      const cached = await getCache<{
        trips: unknown[];
        origin: string;
        destination: string;
        requestedAt: string;
        backend: string;
      }>(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true });
      }
    }

    // --- Try Neo4j first ---
    let trips = await findTripsNeo4j(origin, destination, {
      alternatives,
      maxTransfers,
      avoidRoutes,
    });
    let backend: 'neo4j' | 'in-memory' = 'neo4j';

    // --- Fall back to in-memory Dijkstra ---
    if (!trips || trips.length === 0) {
      trips = await getAlternativeTrips(origin, destination, alternatives, {
        maxTransfers,
        avoidRoutes,
        preferFewerTransfers: true,
      });
      backend = 'in-memory';
    }

    if (!trips || trips.length === 0) {
      return notFound(`No routes found from ${origin} to ${destination}`);
    }

    console.log(
      `[trip-api] ${origin} -> ${destination}: ${trips.length} trip(s) via ${backend}`,
    );

    const response = {
      trips,
      origin,
      destination,
      requestedAt: new Date().toISOString(),
      backend,
    };

    // --- Cache the result ---
    await setCache(cacheKey, response, CACHE_TTL_SECONDS);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[trip-api] Error planning trip:', error);
    return internalError(
      error instanceof Error ? error.message : 'Failed to plan trip',
    );
  }
}
