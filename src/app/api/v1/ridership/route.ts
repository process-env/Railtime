import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { RidershipDay, RidershipResponse } from '@/types/ridership';

// New hourly ridership dataset (Beginning 2025, actively updated)
const SOCRATA_URL = 'https://data.ny.gov/resource/5wq4-mkjj.json';

// Pre-pandemic baseline for comparison (avg weekday ridership 2019)
const PRE_PANDEMIC_DAILY_AVG = 5_500_000;

// Cache — 1 hour TTL, keyed by days param
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  data: RidershipResponse;
  timestamp: number;
  key: string;
}

let cache: CacheEntry | null = null;

function buildSocrataUrl(days: number): string {
  const params = new URLSearchParams({
    '$select': 'date_trunc_ymd(transit_timestamp) as day,sum(ridership) as total_ridership',
    '$where': "transit_mode='subway'",
    '$group': 'date_trunc_ymd(transit_timestamp)',
    '$order': 'day DESC',
    '$limit': String(days),
  });
  return `${SOCRATA_URL}?${params.toString()}`;
}

function parseSocrataRow(row: Record<string, string>): RidershipDay {
  const ridership = Math.round(parseFloat(row.total_ridership) || 0);
  return {
    date: row.day ?? '',
    ridership,
    prePandemicPercent: ridership > 0
      ? Math.round((ridership / PRE_PANDEMIC_DAILY_AVG) * 1000) / 10
      : 0,
  };
}

function buildResponse(rows: Record<string, string>[]): RidershipResponse {
  const days: RidershipDay[] = rows.map(parseSocrataRow);
  const totalRidership = days.reduce((sum, d) => sum + d.ridership, 0);
  const avgDaily = days.length > 0 ? Math.round(totalRidership / days.length) : 0;
  const latest = days.length > 0 ? days[0] : null;

  return {
    days,
    latest,
    avgDaily,
    totalRidership,
    dailyFareRevenue: latest ? Math.round(latest.ridership * 2.90) : 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const daysParam = searchParams.get('days');
  const days = daysParam ? parseInt(daysParam, 10) : 30;

  if (isNaN(days) || days < 1) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid days parameter' } },
      { status: 400 },
    );
  }

  const clampedDays = Math.min(days, 365);
  const cacheKey = `ridership-${clampedDays}`;

  try {
    const now = Date.now();
    if (cache && cache.key === cacheKey && (now - cache.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cache.data, {
        headers: {
          'X-Cache': 'HIT',
          'X-Cache-Age': String(Math.floor((now - cache.timestamp) / 1000)),
        },
      });
    }

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

    cache = { data, timestamp: now, key: cacheKey };

    return NextResponse.json(data, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Ridership API error:', error);

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
