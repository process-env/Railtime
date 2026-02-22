import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { RidershipDay, RidershipResponse } from '@/types/ridership';

// Socrata open data endpoint — no auth required
const SOCRATA_URL = 'https://data.ny.gov/resource/vxuj-8kew.json';

// Valid day ranges
const VALID_DAYS = new Set([7, 30, 90, 365]);

// Cache configuration — 1 hour TTL, keyed by days param
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  data: RidershipResponse;
  timestamp: number;
  key: string;
}

let cache: CacheEntry | null = null;

/**
 * Build a SoQL query URL for the Socrata ridership endpoint.
 */
function buildSocrataUrl(days: number): string {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const fromDateStr = fromDate.toISOString().split('T')[0]; // YYYY-MM-DD

  const params = new URLSearchParams({
    $order: 'date DESC',
    $limit: String(days),
    $where: `date > '${fromDateStr}'`,
  });

  return `${SOCRATA_URL}?${params.toString()}`;
}

/**
 * Parse a single Socrata row into a RidershipDay.
 * Socrata fields are strings; we parse them to numbers.
 */
function parseSocrataRow(row: Record<string, string>): RidershipDay {
  return {
    date: row.date ?? '',
    ridership: parseInt(row.subways_total_estimated_ridership, 10) || 0,
    prePandemicPercent: parseFloat(row.subways_of_comparable_pre_pandemic_day) || 0,
  };
}

/**
 * Transform raw Socrata rows into a RidershipResponse.
 */
function buildResponse(rows: Record<string, string>[]): RidershipResponse {
  const days: RidershipDay[] = rows.map(parseSocrataRow);

  const totalRidership = days.reduce((sum, d) => sum + d.ridership, 0);
  const avgDaily = days.length > 0 ? Math.round(totalRidership / days.length) : 0;
  const latest = days.length > 0 ? days[0] : null; // Already sorted DESC

  return {
    days,
    latest,
    avgDaily,
    totalRidership,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  // Parse and validate days param
  const searchParams = request.nextUrl.searchParams;
  const daysParam = searchParams.get('days');
  const days = daysParam ? parseInt(daysParam, 10) : 30;

  if (isNaN(days) || days < 1) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid days parameter' } },
      { status: 400 },
    );
  }

  // Clamp to valid range
  const clampedDays = Math.min(days, 365);
  const cacheKey = `ridership-${clampedDays}`;

  try {
    // Check cache — must match the same days param
    const now = Date.now();
    if (cache && cache.key === cacheKey && (now - cache.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cache.data, {
        headers: {
          'X-Cache': 'HIT',
          'X-Cache-Age': String(Math.floor((now - cache.timestamp) / 1000)),
        },
      });
    }

    // Fetch from Socrata
    const url = buildSocrataUrl(clampedDays);
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      throw new Error(`Socrata API returned ${res.status}: ${res.statusText}`);
    }

    const rawRows: Record<string, string>[] = await res.json();
    const data = buildResponse(rawRows);

    // Update cache
    cache = { data, timestamp: now, key: cacheKey };

    return NextResponse.json(data, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Ridership API error:', error);

    // Return stale cache if available (even for different days param)
    if (cache) {
      return NextResponse.json(cache.data, {
        headers: {
          'X-Cache': 'STALE',
          'X-Cache-Age': String(Math.floor((Date.now() - cache.timestamp) / 1000)),
        },
      });
    }

    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Failed to fetch ridership data',
        },
      },
      { status: 502 },
    );
  }
}
