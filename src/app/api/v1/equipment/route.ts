import { NextResponse } from 'next/server';
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
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: EquipmentStatusResponse;
  timestamp: number;
}

let cache: CacheEntry | null = null;

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

export async function GET() {
  try {
    // Check cache
    const now = Date.now();
    if (cache && (now - cache.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cache.data, {
        headers: {
          'X-Cache': 'HIT',
          'X-Cache-Age': String(Math.floor((now - cache.timestamp) / 1000)),
        },
      });
    }

    // Fetch fresh data
    const data = await fetchEquipmentData();

    // Update cache
    cache = {
      data,
      timestamp: now,
    };

    return NextResponse.json(data, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Equipment API error:', error);

    // Return stale cache if available
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
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch equipment status'
        }
      },
      { status: 500 }
    );
  }
}
