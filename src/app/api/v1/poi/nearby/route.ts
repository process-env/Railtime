import { NextRequest, NextResponse } from 'next/server';
import { rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';
import type { POI, TomTomSearchResponse, POISearchResponse } from '@/types/poi';

const TOMTOM_API_KEY = process.env.TOMTOM_ADMIN_KEY;
const CACHE_TTL = 3600; // 1 hour in seconds

// In-memory cache for POI results
const poiCache = new Map<string, { data: POISearchResponse; expires: number }>();

function getCacheKey(lat: number, lon: number, radius: number, category?: string): string {
  // Round coordinates to 4 decimal places (~11m precision) for cache efficiency
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLon = Math.round(lon * 10000) / 10000;
  return `${roundedLat},${roundedLon},${radius},${category || 'all'}`;
}

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientId(request);
  const rlKey = createRateLimitKey(clientId, '/api/v1/poi');
  const rl = checkRateLimit(rlKey, RATE_LIMITS.search);
  if (!rl.success) {
    return rateLimited(rl.resetIn);
  }

  const { searchParams } = new URL(request.url);

  const lat = parseFloat(searchParams.get('lat') || '');
  const lon = parseFloat(searchParams.get('lon') || '');
  const radius = parseInt(searchParams.get('radius') || '300', 10);
  const category = searchParams.get('category') || undefined;
  const limit = parseInt(searchParams.get('limit') || '10', 10);

  // Validate required params
  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json(
      { error: 'Missing required parameters: lat and lon' },
      { status: 400 }
    );
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Coordinates out of range' }, { status: 400 });
  }

  if (category && !/^\d+(,\d+)*$/.test(category)) {
    return NextResponse.json({ error: 'Invalid category format' }, { status: 400 });
  }

  // Validate API key
  if (!TOMTOM_API_KEY) {
    return NextResponse.json(
      { error: 'TomTom API key not configured' },
      { status: 500 }
    );
  }

  // Check cache
  const cacheKey = getCacheKey(lat, lon, radius, category);
  const cached = poiCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, max-age=300', // Browser cache for 5 min
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    // Build TomTom Nearby Search URL
    const tomtomUrl = new URL('https://api.tomtom.com/search/2/nearbySearch/.json');
    tomtomUrl.searchParams.set('key', TOMTOM_API_KEY);
    tomtomUrl.searchParams.set('lat', lat.toString());
    tomtomUrl.searchParams.set('lon', lon.toString());
    tomtomUrl.searchParams.set('radius', Math.min(radius, 5000).toString()); // Max 5km
    tomtomUrl.searchParams.set('limit', Math.min(limit, 50).toString()); // Max 50

    // Add category filter if provided
    // Common category IDs: 7315 (restaurant), 9376 (coffee), 7397 (bank/ATM), 9663 (pharmacy), 9361 (convenience)
    if (category) {
      tomtomUrl.searchParams.set('categorySet', category);
    }

    const response = await fetch(tomtomUrl.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('TomTom API error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to fetch POI data' },
        { status: 502 }
      );
    }

    const data: TomTomSearchResponse = await response.json();

    // Transform TomTom response to our POI format
    const pois: POI[] = data.results.map((result) => ({
      id: result.id,
      name: result.poi.name,
      category: result.poi.categories?.[0] || 'Unknown',
      categoryIcon: getCategoryIcon(result.poi.categories?.[0]),
      lat: result.position.lat,
      lon: result.position.lon,
      address: result.address.freeformAddress,
      distance: Math.round(result.dist),
      phone: result.poi.phone,
      url: result.poi.url,
    }));

    const responseData: POISearchResponse = {
      pois,
      total: data.summary.totalResults,
    };

    // Cache the result
    poiCache.set(cacheKey, {
      data: responseData,
      expires: Date.now() + CACHE_TTL * 1000,
    });

    // Clean up old cache entries periodically
    if (poiCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of poiCache.entries()) {
        if (value.expires < now) {
          poiCache.delete(key);
        }
      }
    }

    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('POI search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getCategoryIcon(category?: string): string {
  if (!category) return '📍';

  const lower = category.toLowerCase();
  if (lower.includes('restaurant') || lower.includes('food')) return '🍽️';
  if (lower.includes('coffee') || lower.includes('cafe')) return '☕';
  if (lower.includes('bank') || lower.includes('atm')) return '🏦';
  if (lower.includes('pharmacy') || lower.includes('drug')) return '💊';
  if (lower.includes('convenience') || lower.includes('store')) return '🏪';
  if (lower.includes('grocery') || lower.includes('supermarket')) return '🛒';
  if (lower.includes('bar') || lower.includes('pub')) return '🍺';
  if (lower.includes('hotel') || lower.includes('lodging')) return '🏨';
  if (lower.includes('gas') || lower.includes('fuel')) return '⛽';
  if (lower.includes('parking')) return '🅿️';

  return '📍';
}
