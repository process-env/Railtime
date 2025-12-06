import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const STOP_TIMES_CSV = path.join(DATA_DIR, 'stop_times.txt');
const TRIPS_CSV = path.join(DATA_DIR, 'trips.txt');
const STOPS_CSV = path.join(DATA_DIR, 'stops.txt');

// ============================================================================
// Types
// ============================================================================

export interface StopTime {
  tripId: string;
  stopId: string;
  arrivalTime: string; // "HH:MM:SS" format
  departureTime: string;
  stopSequence: number;
}

export interface TripWithStops {
  tripId: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  directionId: string;
  stops: StopTime[];
  durationMinutes: number;
  stopCount: number;
}

export interface RouteScheduleStats {
  routeId: string;
  directions: {
    directionId: string;
    headsign: string;
    avgHeadwayMinutes: number;
    firstTrain: string;
    lastTrain: string;
    tripsPerDay: number;
    avgDurationMinutes: number;
    stopCount: number;
  }[];
}

export interface StationStats {
  stopId: string;
  stopName: string;
  dailyTrains: number;
  routes: string[];
}

export interface ScheduleData {
  routeStats: RouteScheduleStats[];
  busiestStations: StationStats[];
  serviceDay: 'Weekday' | 'Saturday' | 'Sunday';
  totalTrips: number;
  totalStops: number;
}

// ============================================================================
// Cache
// ============================================================================

let stopTimesCache: Map<string, StopTime[]> | null = null;
let tripsInfoCache: Map<string, { routeId: string; serviceId: string; headsign: string; directionId: string }> | null = null;
let stopsNameCache: Map<string, string> | null = null;
let scheduleDataCache: ScheduleData | null = null;

// ============================================================================
// Time Utilities
// ============================================================================

/**
 * Parse GTFS time string to minutes since midnight.
 * GTFS allows times > 24:00:00 for trips past midnight.
 */
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Format minutes to HH:MM display string.
 */
function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Get current service day based on day of week.
 */
function getCurrentServiceDay(): 'Weekday' | 'Saturday' | 'Sunday' {
  const day = new Date().getDay();
  if (day === 0) return 'Sunday';
  if (day === 6) return 'Saturday';
  return 'Weekday';
}

// ============================================================================
// Data Loading
// ============================================================================

/**
 * Load trips.txt to get route/service info for each trip.
 */
async function loadTripsInfo(): Promise<Map<string, { routeId: string; serviceId: string; headsign: string; directionId: string }>> {
  if (tripsInfoCache) return tripsInfoCache;

  const text = await fs.readFile(TRIPS_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  tripsInfoCache = new Map();
  for (const r of rows) {
    tripsInfoCache.set(r.trip_id, {
      routeId: r.route_id,
      serviceId: r.service_id,
      headsign: r.trip_headsign,
      directionId: r.direction_id,
    });
  }

  return tripsInfoCache;
}

/**
 * Load stops.txt to get station names.
 */
async function loadStopsNames(): Promise<Map<string, string>> {
  if (stopsNameCache) return stopsNameCache;

  const text = await fs.readFile(STOPS_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  stopsNameCache = new Map();
  for (const r of rows) {
    // Only store parent stations (location_type = 1 or no parent)
    if (r.location_type === '1' || !r.parent_station) {
      stopsNameCache.set(r.stop_id, r.stop_name);
    }
  }

  return stopsNameCache;
}

/**
 * Load stop_times.txt and build indexes.
 */
export async function loadStopTimes(): Promise<Map<string, StopTime[]>> {
  if (stopTimesCache) return stopTimesCache;

  console.log('Loading stop_times data...');
  const startTime = Date.now();

  const text = await fs.readFile(STOP_TIMES_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // Group stop times by trip_id
  stopTimesCache = new Map();
  for (const r of rows) {
    const stopTime: StopTime = {
      tripId: r.trip_id,
      stopId: r.stop_id,
      arrivalTime: r.arrival_time,
      departureTime: r.departure_time,
      stopSequence: parseInt(r.stop_sequence, 10),
    };

    const existing = stopTimesCache.get(r.trip_id) || [];
    existing.push(stopTime);
    stopTimesCache.set(r.trip_id, existing);
  }

  // Sort each trip's stops by sequence
  for (const [tripId, stops] of stopTimesCache) {
    stops.sort((a, b) => a.stopSequence - b.stopSequence);
    stopTimesCache.set(tripId, stops);
  }

  console.log(`Stop times loaded in ${Date.now() - startTime}ms (${rows.length} entries, ${stopTimesCache.size} trips)`);
  return stopTimesCache;
}

// ============================================================================
// Schedule Statistics
// ============================================================================

/**
 * Calculate schedule statistics from GTFS static data.
 * Pre-computes aggregates for efficient API responses.
 */
export async function getScheduleStats(): Promise<ScheduleData> {
  if (scheduleDataCache) return scheduleDataCache;

  console.log('Computing schedule statistics...');
  const startTime = Date.now();

  const [stopTimes, tripsInfo, stopsNames] = await Promise.all([
    loadStopTimes(),
    loadTripsInfo(),
    loadStopsNames(),
  ]);

  const serviceDay = getCurrentServiceDay();

  // Filter trips for current service day
  const todayTrips = new Map<string, StopTime[]>();
  let totalStops = 0;

  for (const [tripId, stops] of stopTimes) {
    const info = tripsInfo.get(tripId);
    if (info && info.serviceId === serviceDay) {
      todayTrips.set(tripId, stops);
      totalStops += stops.length;
    }
  }

  // Calculate route statistics
  const routeStatsMap = new Map<string, Map<string, {
    headsign: string;
    tripTimes: number[]; // First stop departure times in minutes
    durations: number[];
    stopCounts: number[];
  }>>();

  for (const [tripId, stops] of todayTrips) {
    const info = tripsInfo.get(tripId);
    if (!info || stops.length === 0) continue;

    const routeId = info.routeId;
    const directionId = info.directionId;
    const headsign = info.headsign;

    if (!routeStatsMap.has(routeId)) {
      routeStatsMap.set(routeId, new Map());
    }
    const dirMap = routeStatsMap.get(routeId)!;

    if (!dirMap.has(directionId)) {
      dirMap.set(directionId, {
        headsign,
        tripTimes: [],
        durations: [],
        stopCounts: [],
      });
    }

    const stats = dirMap.get(directionId)!;
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    stats.tripTimes.push(parseTimeToMinutes(firstStop.departureTime));
    stats.durations.push(
      parseTimeToMinutes(lastStop.arrivalTime) - parseTimeToMinutes(firstStop.departureTime)
    );
    stats.stopCounts.push(stops.length);
  }

  // Build route stats array
  const routeStats: RouteScheduleStats[] = [];
  for (const [routeId, dirMap] of routeStatsMap) {
    const directions: RouteScheduleStats['directions'] = [];

    for (const [directionId, stats] of dirMap) {
      if (stats.tripTimes.length === 0) continue;

      // Sort trip times to calculate headways
      stats.tripTimes.sort((a, b) => a - b);

      // Calculate average headway (time between consecutive trips)
      let totalHeadway = 0;
      let headwayCount = 0;
      for (let i = 1; i < stats.tripTimes.length; i++) {
        const headway = stats.tripTimes[i] - stats.tripTimes[i - 1];
        if (headway > 0 && headway < 120) { // Ignore gaps > 2 hours
          totalHeadway += headway;
          headwayCount++;
        }
      }
      const avgHeadway = headwayCount > 0 ? totalHeadway / headwayCount : 0;

      // Calculate average duration
      const avgDuration = stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length;
      const avgStopCount = Math.round(stats.stopCounts.reduce((a, b) => a + b, 0) / stats.stopCounts.length);

      directions.push({
        directionId,
        headsign: stats.headsign,
        avgHeadwayMinutes: Math.round(avgHeadway),
        firstTrain: formatMinutesToTime(stats.tripTimes[0]),
        lastTrain: formatMinutesToTime(stats.tripTimes[stats.tripTimes.length - 1]),
        tripsPerDay: stats.tripTimes.length,
        avgDurationMinutes: Math.round(avgDuration),
        stopCount: avgStopCount,
      });
    }

    if (directions.length > 0) {
      routeStats.push({ routeId, directions });
    }
  }

  // Sort routes alphabetically (numbers first, then letters)
  routeStats.sort((a, b) => {
    const aNum = parseInt(a.routeId, 10);
    const bNum = parseInt(b.routeId, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    if (!isNaN(aNum)) return -1;
    if (!isNaN(bNum)) return 1;
    return a.routeId.localeCompare(b.routeId);
  });

  // Calculate busiest stations
  const stationTrainCount = new Map<string, { count: number; routes: Set<string> }>();

  for (const [tripId, stops] of todayTrips) {
    const info = tripsInfo.get(tripId);
    if (!info) continue;

    for (const stop of stops) {
      // Use base stop ID (without N/S suffix) for grouping
      const baseStopId = stop.stopId.replace(/[NS]$/, '');

      if (!stationTrainCount.has(baseStopId)) {
        stationTrainCount.set(baseStopId, { count: 0, routes: new Set() });
      }
      const entry = stationTrainCount.get(baseStopId)!;
      entry.count++;
      entry.routes.add(info.routeId);
    }
  }

  // Get top 20 busiest stations
  const busiestStations: StationStats[] = Array.from(stationTrainCount.entries())
    .map(([stopId, data]) => ({
      stopId,
      stopName: stopsNames.get(stopId) || stopId,
      dailyTrains: data.count,
      routes: Array.from(data.routes).sort(),
    }))
    .sort((a, b) => b.dailyTrains - a.dailyTrains)
    .slice(0, 20);

  scheduleDataCache = {
    routeStats,
    busiestStations,
    serviceDay,
    totalTrips: todayTrips.size,
    totalStops,
  };

  console.log(`Schedule stats computed in ${Date.now() - startTime}ms`);
  return scheduleDataCache;
}

/**
 * Get schedule stats for a specific route.
 */
export async function getRouteSchedule(routeId: string): Promise<RouteScheduleStats | null> {
  const data = await getScheduleStats();
  return data.routeStats.find(r => r.routeId === routeId) || null;
}

/**
 * Clear all caches (for testing or forced refresh).
 */
export function clearScheduleCache(): void {
  stopTimesCache = null;
  tripsInfoCache = null;
  stopsNameCache = null;
  scheduleDataCache = null;
}
