import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const STOP_TIMES_CSV = path.join(DATA_DIR, 'stop_times.txt');

interface StopTime {
  tripId: string;
  stopId: string;
  arrivalTime: string; // HH:MM:SS format
}

// Cache: Map<stopId, Map<tripId, arrivalTimeSeconds>>
let scheduleCache: Map<string, Map<string, number>> | null = null;

/**
 * Parse time string (HH:MM:SS) to seconds since midnight
 * Handles times > 24:00:00 for trips that span midnight
 */
function parseTimeToSeconds(timeStr: string): number {
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Load stop_times.txt and build lookup cache
 */
export async function loadSchedule(): Promise<Map<string, Map<string, number>>> {
  if (scheduleCache) return scheduleCache;

  console.log('Loading schedule data from stop_times.txt...');
  const startTime = Date.now();

  const text = await fs.readFile(STOP_TIMES_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // Build lookup: stopId -> (tripId -> arrivalSeconds)
  scheduleCache = new Map();

  for (const r of rows) {
    const stopId = r.stop_id;
    const tripId = r.trip_id;
    const arrivalSeconds = parseTimeToSeconds(r.arrival_time);

    if (!scheduleCache.has(stopId)) {
      scheduleCache.set(stopId, new Map());
    }
    scheduleCache.get(stopId)!.set(tripId, arrivalSeconds);
  }

  console.log(`Schedule loaded in ${Date.now() - startTime}ms (${rows.length} stop times)`);
  return scheduleCache;
}

/**
 * Get scheduled arrival time in seconds since midnight
 * Returns null if no schedule found for this trip/stop combination
 */
export async function getScheduledArrivalSeconds(
  tripId: string,
  stopId: string
): Promise<number | null> {
  const schedule = await loadSchedule();
  const stopSchedule = schedule.get(stopId);
  if (!stopSchedule) return null;
  return stopSchedule.get(tripId) ?? null;
}

/**
 * Calculate delay in seconds given predicted arrival time and trip/stop
 * Returns null if no schedule data available
 */
export async function calculateDelay(
  tripId: string,
  stopId: string,
  predictedArrival: Date
): Promise<number | null> {
  const scheduledSeconds = await getScheduledArrivalSeconds(tripId, stopId);
  if (scheduledSeconds === null) return null;

  // Get predicted time as seconds since midnight (in NYC timezone)
  const predictedNYC = new Date(predictedArrival.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const predictedSeconds =
    predictedNYC.getHours() * 3600 +
    predictedNYC.getMinutes() * 60 +
    predictedNYC.getSeconds();

  // Delay = predicted - scheduled (positive = late, negative = early)
  return predictedSeconds - scheduledSeconds;
}

/**
 * Clear cache (for testing)
 */
export function clearScheduleCache(): void {
  scheduleCache = null;
}
