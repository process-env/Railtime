import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '..', 'public', 'data');

// Map: "tripId:stopId" → seconds since midnight (scheduled arrival)
let scheduleMap: Map<string, number> | null = null;
let currentServiceId: string | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Get today's service_id based on day of week (NYC local time).
 * Uses America/New_York timezone.
 */
function getTodayServiceId(): string {
  const now = new Date();
  // Get NYC day of week
  const nycDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(now);

  if (nycDay === 'Saturday') return 'Saturday';
  if (nycDay === 'Sunday') return 'Sunday';
  return 'Weekday';
}

/**
 * Parse GTFS time string (HH:MM:SS) to seconds since midnight.
 * Handles times > 24:00:00 for after-midnight service.
 */
function parseGtfsTime(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length !== 3) return -1;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return -1;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Extract the normalized "trip key prefix" from a trip ID suffix.
 * Static GTFS uses suffixes like "113100_A..N55R" while GTFS-RT uses
 * "113100_A..N85X003". The common part is everything up to and including
 * the direction character (N or S) after "..": "113100_A..N".
 */
function getTripKeyPrefix(tripId: string): string {
  const dotDotIdx = tripId.indexOf('..');
  if (dotDotIdx === -1) return tripId; // fallback
  // Take up to ".." + direction char (N or S) = dotDotIdx + 3
  return tripId.substring(0, dotDotIdx + 3);
}

/**
 * Parse a simple CSV line (no quoted fields in GTFS data).
 */
function parseCsvLine(line: string): string[] {
  return line.split(',');
}

/**
 * Load schedule into memory. Filters to today's service_id.
 */
async function buildScheduleMap(): Promise<Map<string, number>> {
  const serviceId = getTodayServiceId();
  console.log(`[schedule-lookup] Building schedule for service: ${serviceId}`);

  // Step 1: Load trips.txt, collect trip IDs for today's service
  const tripsPath = path.join(DATA_DIR, 'trips.txt');
  const tripsText = await fs.readFile(tripsPath, 'utf8');
  const tripsLines = tripsText.split('\n').filter(l => l.trim().length > 0);

  const headers = parseCsvLine(tripsLines[0]);
  const tripIdIdx = headers.indexOf('trip_id');
  const serviceIdIdx = headers.indexOf('service_id');

  if (tripIdIdx === -1 || serviceIdIdx === -1) {
    throw new Error('trips.txt missing required columns');
  }

  // Build a set of valid trip prefixes. GTFS static trip IDs look like
  // "AFA25GEN-1039-Saturday-00_113100_A..N55R" but GTFS-RT uses
  // "113100_A..N85X003". The common part is "113100_A..N" — everything
  // up to and including the direction char after "..". We normalize to
  // this prefix so RT lookups match static schedule entries.
  const validPrefixes = new Set<string>();
  for (let i = 1; i < tripsLines.length; i++) {
    const cols = parseCsvLine(tripsLines[i]);
    if (cols[serviceIdIdx]?.trim() === serviceId) {
      const fullTripId = cols[tripIdIdx].trim();
      const underscoreIdx = fullTripId.indexOf('_');
      const suffix = underscoreIdx !== -1
        ? fullTripId.substring(underscoreIdx + 1)
        : fullTripId; // fallback: no underscore, use full ID
      const prefix = getTripKeyPrefix(suffix);
      validPrefixes.add(prefix);
    }
  }
  console.log(`[schedule-lookup] ${validPrefixes.size} trip prefixes for ${serviceId}`);

  // Step 2: Load stop_times.txt, build map for valid trips only
  const stopTimesPath = path.join(DATA_DIR, 'stop_times.txt');
  const stopTimesText = await fs.readFile(stopTimesPath, 'utf8');
  const stLines = stopTimesText.split('\n').filter(l => l.trim().length > 0);

  const stHeaders = parseCsvLine(stLines[0]);
  const stTripIdIdx = stHeaders.indexOf('trip_id');
  const stStopIdIdx = stHeaders.indexOf('stop_id');
  const stArrivalIdx = stHeaders.indexOf('arrival_time');

  if (stTripIdIdx === -1 || stStopIdIdx === -1 || stArrivalIdx === -1) {
    throw new Error('stop_times.txt missing required columns');
  }

  const map = new Map<string, number>();
  let loaded = 0;
  for (let i = 1; i < stLines.length; i++) {
    const cols = parseCsvLine(stLines[i]);
    const fullTripId = cols[stTripIdIdx]?.trim();
    if (!fullTripId) continue;

    // Extract suffix then normalize to prefix for GTFS-RT matching
    const underscoreIdx = fullTripId.indexOf('_');
    const suffix = underscoreIdx !== -1
      ? fullTripId.substring(underscoreIdx + 1)
      : fullTripId;
    const prefix = getTripKeyPrefix(suffix);
    if (!validPrefixes.has(prefix)) continue;

    const stopId = cols[stStopIdIdx]?.trim();
    const arrivalStr = cols[stArrivalIdx]?.trim();
    if (!stopId || !arrivalStr) continue;

    const arrivalSec = parseGtfsTime(arrivalStr);
    if (arrivalSec < 0) continue;

    map.set(`${prefix}:${stopId}`, arrivalSec);
    loaded++;
  }

  console.log(`[schedule-lookup] Loaded ${loaded} stop times (${Math.round(loaded / 1024)}K entries)`);
  return map;
}

/**
 * Convert seconds-since-midnight to epoch ms for today (NYC timezone).
 */
function secondsToEpochMs(secondsSinceMidnight: number): number {
  // Get today's midnight in NYC
  const now = new Date();
  const nycDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(now); // "YYYY-MM-DD"

  const midnightNyc = new Date(`${nycDateStr}T00:00:00-05:00`);
  // Adjust for DST: use the actual offset
  const nycOffset = -5 * 3600000; // EST default
  // For simplicity, compute from the date string
  return midnightNyc.getTime() + secondsSinceMidnight * 1000;
}

/**
 * Schedule a rebuild at the next NYC midnight.
 */
function scheduleRebuild(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);

  // Calculate ms until next NYC midnight
  const now = new Date();
  const nycDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(now);
  const tomorrow = new Date(`${nycDateStr}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  // Add 5 hours for EST (approximate — good enough for a timer)
  const msUntilMidnight = tomorrow.getTime() + 5 * 3600000 - now.getTime();

  // Add 60s buffer after midnight to ensure day has changed
  const delay = Math.max(msUntilMidnight + 60000, 60000);

  rebuildTimer = setTimeout(async () => {
    try {
      console.log('[schedule-lookup] Midnight rebuild triggered');
      scheduleMap = await buildScheduleMap();
      currentServiceId = getTodayServiceId();
      scheduleRebuild(); // Schedule next rebuild
    } catch (err) {
      console.error('[schedule-lookup] Midnight rebuild failed:', err instanceof Error ? err.message : err);
      // Retry in 5 minutes
      rebuildTimer = setTimeout(() => scheduleRebuild(), 5 * 60 * 1000);
    }
  }, delay);

  const hours = Math.round(delay / 3600000 * 10) / 10;
  console.log(`[schedule-lookup] Next rebuild in ${hours}h`);
}

// --- Public API ---

/**
 * Initialize the schedule lookup. Call once at server startup.
 * Returns silently if GTFS files are not available.
 */
export async function initScheduleLookup(): Promise<void> {
  try {
    scheduleMap = await buildScheduleMap();
    currentServiceId = getTodayServiceId();
    scheduleRebuild();
  } catch (err) {
    console.warn('[schedule-lookup] Failed to load schedule — delay metrics disabled:', err instanceof Error ? err.message : err);
    scheduleMap = null;
  }
}

/**
 * Look up the scheduled arrival time for a trip at a stop.
 * @returns seconds since midnight, or null if not found
 */
export function getScheduledArrivalSec(tripId: string, stopId: string): number | null {
  if (!scheduleMap) return null;
  const prefix = getTripKeyPrefix(tripId);
  return scheduleMap.get(`${prefix}:${stopId}`) ?? null;
}

/**
 * Convert a GTFS-RT arrival.time (ISO string or epoch string) to seconds since midnight (NYC).
 */
export function arrivalTimeToSecondsSinceMidnight(arrivalTime: string): number | null {
  if (!arrivalTime) return null;

  // arrival.time from feed-loop is an ISO string or epoch seconds string
  let epochMs: number;
  const num = Number(arrivalTime);
  if (!isNaN(num) && num > 1e9) {
    // Epoch seconds (common in GTFS-RT)
    epochMs = num < 1e12 ? num * 1000 : num;
  } else {
    epochMs = new Date(arrivalTime).getTime();
  }

  if (isNaN(epochMs)) return null;

  // Get NYC midnight for this timestamp's date
  const date = new Date(epochMs);
  const nycDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(date);

  // NYC midnight in UTC
  // Create a date at midnight NYC, then get its UTC epoch
  const parts = nycDateStr.split('-').map(Number);
  const nycMidnight = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  // Adjust: NYC midnight is UTC+5 (EST) or UTC+4 (EDT)
  // Get the offset dynamically
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  });
  const offsetMatch = formatter.format(date).match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : -5;
  const midnightUtcMs = nycMidnight.getTime() - offsetHours * 3600000;

  const secSinceMidnight = Math.floor((epochMs - midnightUtcMs) / 1000);
  // Handle after-midnight (> 24h = 86400s): keep as-is for GTFS compatibility
  return secSinceMidnight >= 0 ? secSinceMidnight : null;
}

/**
 * Compute schedule deviation in seconds.
 * Positive = late, negative = early.
 * @returns deviation in seconds, or null if lookup fails
 */
let deviationDiagCount = 0;
const DEVIATION_DIAG_LIMIT = 3;

export function computeDeviation(tripId: string, stopId: string, arrivalTime: string): number | null {
  const scheduledSec = getScheduledArrivalSec(tripId, stopId);
  const actualSec = arrivalTimeToSecondsSinceMidnight(arrivalTime);

  // Diagnostic logging for first N calls to verify trip ID matching
  if (deviationDiagCount < DEVIATION_DIAG_LIMIT) {
    deviationDiagCount++;
    const prefix = getTripKeyPrefix(tripId);
    const key = `${prefix}:${stopId}`;
    const hasMatch = scheduleMap?.has(key) ?? false;
    const deviation = scheduledSec !== null && actualSec !== null ? actualSec - scheduledSec : null;
    console.log(
      `[schedule-lookup] DIAG ${deviationDiagCount}/${DEVIATION_DIAG_LIMIT}: ` +
      `tripId="${tripId}" stopId="${stopId}" matched=${hasMatch} ` +
      `scheduled=${scheduledSec} actual=${actualSec} deviation=${deviation}`
    );
  }

  if (scheduledSec === null) return null;
  if (actualSec === null) return null;

  return actualSec - scheduledSec;
}

/**
 * Check if the schedule is loaded and available.
 */
export function isScheduleLoaded(): boolean {
  return scheduleMap !== null && scheduleMap.size > 0;
}

/**
 * Stop the rebuild timer (for graceful shutdown).
 */
export function stopScheduleLookup(): void {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
}
