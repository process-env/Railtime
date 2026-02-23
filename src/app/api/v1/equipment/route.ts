import { NextRequest, NextResponse } from 'next/server';
import { rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';
import { getCache, setCache } from '@/lib/redis';
import type {
  EquipmentOutage,
  Equipment,
  ProcessedOutage,
  EquipmentStats,
  EquipmentStatusResponse,
} from '@/types/equipment';

const MTA_ENE_CURRENT = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json';
const MTA_ENE_UPCOMING = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_upcoming.json';
const MTA_ENE_EQUIPMENT = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_equipments.json';

// Cache configuration
const CACHE_KEY = 'equipment:status';
const CACHE_TTL_SECONDS = 300; // 5 minutes

function parseDate(dateStr: string): Date {
  // Format: "MM/DD/YYYY HH:MM:SS AM/PM"
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function processOutage(outage: EquipmentOutage): ProcessedOutage {
  const outageStart = parseDate(outage.outagedate);
  const estimatedReturn = parseDate(outage.estimatedreturntoservice);
  const now = new Date();
  const daysOut = Math.floor((now.getTime() - outageStart.getTime()) / (1000 * 60 * 60 * 24));

  return {
    id: outage.equipment,
    station: outage.station,
    routes: outage.trainno.split('/').map(r => r.trim()),
    equipmentId: outage.equipment,
    type: outage.equipmenttype === 'EL' ? 'elevator' : 'escalator',
    serving: outage.serving,
    isADA: outage.ADA === 'Y',
    outageStart,
    estimatedReturn,
    reason: outage.reason,
    isUpcoming: outage.isupcomingoutage === 'Y',
    isMaintenance: outage.ismaintenanceoutage === 'Y',
    daysOut: Math.max(0, daysOut),
  };
}

async function fetchEquipmentData(): Promise<EquipmentStatusResponse> {
  // Fetch all three APIs in parallel
  const [currentRes, upcomingRes, equipmentRes] = await Promise.all([
    fetch(MTA_ENE_CURRENT, { next: { revalidate: 300 } }),
    fetch(MTA_ENE_UPCOMING, { next: { revalidate: 300 } }),
    fetch(MTA_ENE_EQUIPMENT, { next: { revalidate: 3600 } }), // Equipment list changes rarely
  ]);

  if (!currentRes.ok || !upcomingRes.ok || !equipmentRes.ok) {
    throw new Error('Failed to fetch equipment data from MTA');
  }

  const [currentData, upcomingData, equipmentData]: [EquipmentOutage[], EquipmentOutage[], Equipment[]] =
    await Promise.all([
      currentRes.json(),
      upcomingRes.json(),
      equipmentRes.json(),
    ]);

  // Process outages
  const currentOutages = currentData
    .filter(o => o.isupcomingoutage !== 'Y')
    .map(processOutage);

  const upcomingOutages = upcomingData
    .filter(o => o.isupcomingoutage === 'Y')
    .map(processOutage);

  // Calculate stats from equipment list
  const totalElevators = equipmentData.filter(e => e.equipmenttype === 'EL').length;
  const totalEscalators = equipmentData.filter(e => e.equipmenttype === 'ES').length;

  const elevatorOutages = currentOutages.filter(o => o.type === 'elevator').length;
  const escalatorOutages = currentOutages.filter(o => o.type === 'escalator').length;
  const adaAffected = currentOutages.filter(o => o.isADA).length;

  const stats: EquipmentStats = {
    totalElevators,
    totalEscalators,
    elevatorOutages,
    escalatorOutages,
    adaAffected,
    upcomingOutages: upcomingOutages.length,
  };

  return {
    currentOutages,
    upcomingOutages,
    stats,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientId = getClientId(request);
  const key = createRateLimitKey(clientId, '/api/v1/equipment');
  const limit = checkRateLimit(key, RATE_LIMITS.search);
  if (!limit.success) {
    return rateLimited(limit.resetIn);
  }

  try {
    // Check Redis cache
    const cached = await getCache<EquipmentStatusResponse>(CACHE_KEY);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
        },
      });
    }

    // Fetch fresh data
    const data = await fetchEquipmentData();

    // Write to Redis (fire-and-forget)
    setCache(CACHE_KEY, data, CACHE_TTL_SECONDS).catch(() => {});

    return NextResponse.json(data, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Equipment API error:', error);

    // Try stale cache on error
    const stale = await getCache<EquipmentStatusResponse>(CACHE_KEY);
    if (stale) {
      return NextResponse.json(stale, {
        headers: {
          'X-Cache': 'STALE',
        },
      });
    }

    return NextResponse.json(
      {
        error: {
          code: 'FETCH_ERROR',
          message: 'Failed to fetch equipment status'
        }
      },
      { status: 500 }
    );
  }
}
