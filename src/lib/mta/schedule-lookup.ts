import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const STOP_TIMES_CSV = path.join(DATA_DIR, 'stop_times.txt');
const TRIPS_CSV = path.join(DATA_DIR, 'trips.txt');
const CACHE_FILE = path.join(DATA_DIR, 'schedule-cache.json');

// Promise-based loading to prevent duplicate loads
let loadingPromise: Promise<void> | null = null;

// ============================================================================
// Types
// ============================================================================

interface ScheduleEntry {
  arrivalMinutes: number; // Minutes from midnight
  departureMinutes: number;
  stopSequence: number;
}

// ============================================================================
// Cache - 3-Tier Lookup System
// ============================================================================

// Tier 1: Primary - Key: "tripId:stopId" → ScheduleEntry
let scheduleCache: Map<string, ScheduleEntry> | null = null;

// Tier 2: Shape-based fallback - Key: "routeId:shapeId:stopId" → ScheduleEntry
let shapeScheduleIndex: Map<string, ScheduleEntry> | null = null;

// Tier 3: Direction-only fallback - Key: "routeId:direction:stopId" → ScheduleEntry
let directionScheduleIndex: Map<string, ScheduleEntry> | null = null;

// Trip to route mapping - Key: "tripId" → routeId
let tripRouteCache: Map<string, string> | null = null;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse GTFS time string (HH:MM:SS) to minutes from midnight.
 * GTFS allows times > 24:00:00 for trips past midnight.
 */
function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

/**
 * Extract trip ID suffix for matching GTFS-RT trip IDs.
 * Full format: "AFA25GEN-1038-Sunday-00_000600_1..S03R"
 * Suffix: "000600_1..S03R"
 */
function extractTripSuffix(fullTripId: string): string | null {
  const match = fullTripId.match(/-00_(.+)$/);
  return match ? match[1] : null;
}

/**
 * Extract shape_id from a GTFS-RT trip ID suffix.
 * Input: "114450_N..N31R" -> Output: "N..N31R"
 * Input: "031700_1..S03R" -> Output: "1..S03R"
 * Input: "119650_7..N" -> Output: "7..N" (truncated format from some feeds)
 */
function extractShapeFromTripId(tripId: string): string | null {
  const match = tripId.match(/_([A-Z0-9]+\.\.[NS][A-Z0-9]*)$/i);
  return match ? match[1] : null;
}

/**
 * Extract direction (N or S) from a shape pattern.
 * Input: "7..N" -> "N"
 * Input: "N..S31R" -> "S"
 */
function extractDirectionFromShape(shape: string): string | null {
  const match = shape.match(/\.\.([NS])/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Normalize stop ID by removing N/S suffix for matching.
 * "101N" or "101S" → "101"
 */
function normalizeStopId(stopId: string): string {
  return stopId.replace(/[NS]$/, '');
}

// ============================================================================
// Data Loading
// ============================================================================

interface CacheData {
  tier1: [string, ScheduleEntry][];
  tier2: [string, ScheduleEntry][];
  tier3: [string, ScheduleEntry][];
  tripRoutes: [string, string][];
  version: number;
}

const CACHE_VERSION = 1;

/**
 * Try to load from JSON cache (much faster than CSV parsing)
 */
async function tryLoadFromCache(): Promise<boolean> {
  try {
    const cacheText = await fs.readFile(CACHE_FILE, 'utf8');
    const cache: CacheData = JSON.parse(cacheText);

    if (cache.version !== CACHE_VERSION) {
      console.log('Schedule cache version mismatch, rebuilding...');
      return false;
    }

    scheduleCache = new Map(cache.tier1);
    shapeScheduleIndex = new Map(cache.tier2);
    directionScheduleIndex = new Map(cache.tier3);
    tripRouteCache = new Map(cache.tripRoutes);

    return true;
  } catch {
    return false;
  }
}

/**
 * Save current caches to JSON for faster future loads
 */
async function saveToCache(): Promise<void> {
  try {
    const cache: CacheData = {
      tier1: Array.from(scheduleCache!.entries()),
      tier2: Array.from(shapeScheduleIndex!.entries()),
      tier3: Array.from(directionScheduleIndex!.entries()),
      tripRoutes: Array.from(tripRouteCache!.entries()),
      version: CACHE_VERSION,
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
    console.log('Schedule cache saved for faster future loads');
  } catch (err) {
    console.warn('Failed to save schedule cache:', err);
  }
}

/**
 * Load schedule data from CSV and build 3-tier lookup caches.
 */
async function loadFromCSV(): Promise<void> {
  console.log('Loading schedule data from CSV (3-tier)...');
  const startTime = Date.now();

  // Load trips first to get route mapping and shape info
  const tripsText = await fs.readFile(TRIPS_CSV, 'utf8');
  const tripsRows = csvParse(tripsText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // Build trip → route and trip → shape mappings
  tripRouteCache = new Map();
  const tripShapeCache = new Map<string, string>(); // tripId → shapeId

  for (const row of tripsRows) {
    const suffix = extractTripSuffix(row.trip_id);

    // Store route mapping
    tripRouteCache.set(row.trip_id, row.route_id);
    if (suffix) {
      tripRouteCache.set(suffix, row.route_id);
    }

    // Store shape mapping - regex works with both full trip_id and suffix (matches end of string)
    const shape = row.shape_id || extractShapeFromTripId(row.trip_id);
    if (shape) {
      tripShapeCache.set(row.trip_id, shape);
      if (suffix) {
        tripShapeCache.set(suffix, shape);
      }
    }
  }

  // Load stop_times and build all 3 indexes
  const stopTimesText = await fs.readFile(STOP_TIMES_CSV, 'utf8');
  const stopTimesRows = csvParse(stopTimesText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  scheduleCache = new Map();
  shapeScheduleIndex = new Map();
  directionScheduleIndex = new Map();

  for (const row of stopTimesRows) {
    const suffix = extractTripSuffix(row.trip_id);
    const baseStopId = normalizeStopId(row.stop_id);
    const routeId = tripRouteCache.get(row.trip_id);
    const shape = tripShapeCache.get(row.trip_id);

    const entry: ScheduleEntry = {
      arrivalMinutes: parseTimeToMinutes(row.arrival_time),
      departureMinutes: parseTimeToMinutes(row.departure_time),
      stopSequence: parseInt(row.stop_sequence, 10),
    };

    // === Tier 1: Direct tripId:stopId lookup ===
    // Store by both full trip ID and suffix
    scheduleCache.set(`${row.trip_id}:${baseStopId}`, entry);
    scheduleCache.set(`${row.trip_id}:${row.stop_id}`, entry);
    if (suffix) {
      scheduleCache.set(`${suffix}:${baseStopId}`, entry);
      scheduleCache.set(`${suffix}:${row.stop_id}`, entry);
    }

    // === Tier 2: Shape-based fallback (routeId:shapeId:stopId) ===
    if (routeId && shape) {
      const shapeKey = `${routeId}:${shape}:${baseStopId}`;
      const shapeKeyOriginal = `${routeId}:${shape}:${row.stop_id}`;
      // Only set if not already present (first occurrence wins)
      if (!shapeScheduleIndex.has(shapeKey)) {
        shapeScheduleIndex.set(shapeKey, entry);
      }
      if (!shapeScheduleIndex.has(shapeKeyOriginal)) {
        shapeScheduleIndex.set(shapeKeyOriginal, entry);
      }
    }

    // === Tier 3: Direction-only fallback (routeId:direction:stopId) ===
    if (routeId && shape) {
      const direction = extractDirectionFromShape(shape);
      if (direction) {
        const dirKey = `${routeId}:${direction}:${baseStopId}`;
        const dirKeyOriginal = `${routeId}:${direction}:${row.stop_id}`;
        // Only set if not already present (first occurrence wins)
        if (!directionScheduleIndex.has(dirKey)) {
          directionScheduleIndex.set(dirKey, entry);
        }
        if (!directionScheduleIndex.has(dirKeyOriginal)) {
          directionScheduleIndex.set(dirKeyOriginal, entry);
        }
      }
    }
  }

  console.log(
    `Schedule data loaded from CSV in ${Date.now() - startTime}ms ` +
    `(Tier1: ${scheduleCache.size}, Tier2: ${shapeScheduleIndex.size}, Tier3: ${directionScheduleIndex.size} entries)`
  );

  // Save cache for faster future loads (async, don't block)
  saveToCache().catch(() => {});
}

/**
 * Load schedule data and build 3-tier lookup caches.
 * Uses JSON cache if available (10x faster), falls back to CSV parsing.
 * Prevents duplicate concurrent loads.
 */
async function loadScheduleData(): Promise<void> {
  // Already loaded
  if (scheduleCache && tripRouteCache && shapeScheduleIndex && directionScheduleIndex) return;

  // Already loading - wait for it
  if (loadingPromise) {
    await loadingPromise;
    return;
  }

  // Start loading
  loadingPromise = (async () => {
    const startTime = Date.now();

    // Try JSON cache first
    const loadedFromCache = await tryLoadFromCache();

    if (loadedFromCache) {
      console.log(`Schedule data loaded from cache in ${Date.now() - startTime}ms`);
    } else {
      await loadFromCSV();
    }
  })();

  await loadingPromise;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the scheduled arrival time for a trip at a specific stop.
 * Uses 3-tier fallback strategy for maximum match rate.
 *
 * @param tripId - GTFS-RT trip ID (e.g., "000600_1..S03R")
 * @param stopId - Stop ID (e.g., "101N" or "101")
 * @param referenceDate - Date to construct the full timestamp
 * @param routeId - Optional route ID for fallback lookups (improves match rate)
 * @returns Scheduled arrival as Date, or null if not found
 */
export async function getScheduledArrival(
  tripId: string,
  stopId: string,
  referenceDate: Date,
  routeId?: string
): Promise<Date | null> {
  await loadScheduleData();

  const baseStopId = normalizeStopId(stopId);
  let entry: ScheduleEntry | undefined;

  // === Tier 1: Direct tripId:stopId lookup ===
  const tier1Keys = [
    `${tripId}:${stopId}`,
    `${tripId}:${baseStopId}`,
  ];
  for (const key of tier1Keys) {
    entry = scheduleCache!.get(key);
    if (entry) break;
  }

  // === Tier 2: Shape-based fallback ===
  if (!entry && routeId) {
    const shape = extractShapeFromTripId(tripId);
    if (shape && shapeScheduleIndex) {
      const tier2Keys = [
        `${routeId}:${shape}:${stopId}`,
        `${routeId}:${shape}:${baseStopId}`,
      ];
      for (const key of tier2Keys) {
        entry = shapeScheduleIndex.get(key);
        if (entry) break;
      }
    }
  }

  // === Tier 3: Direction-only fallback ===
  if (!entry && routeId) {
    const shape = extractShapeFromTripId(tripId);
    const direction = shape ? extractDirectionFromShape(shape) : null;
    if (direction && directionScheduleIndex) {
      const tier3Keys = [
        `${routeId}:${direction}:${stopId}`,
        `${routeId}:${direction}:${baseStopId}`,
      ];
      for (const key of tier3Keys) {
        entry = directionScheduleIndex.get(key);
        if (entry) break;
      }
    }
  }

  if (!entry) return null;

  // Construct full Date from minutes and reference date
  const scheduled = new Date(referenceDate);
  scheduled.setHours(0, 0, 0, 0);
  scheduled.setMinutes(entry.arrivalMinutes);

  return scheduled;
}

/**
 * Calculate delay in seconds between actual arrival and scheduled arrival.
 * Uses 3-tier fallback for maximum match rate.
 *
 * @param tripId - GTFS-RT trip ID
 * @param stopId - Stop ID
 * @param actualArrival - Actual/predicted arrival time
 * @param routeId - Optional route ID for fallback lookups
 * @returns Delay in seconds (positive = late), or null if schedule not found
 */
export async function calculateDelay(
  tripId: string,
  stopId: string,
  actualArrival: Date,
  routeId?: string
): Promise<number | null> {
  const scheduled = await getScheduledArrival(tripId, stopId, actualArrival, routeId);

  if (!scheduled) return null;

  // Calculate delay in seconds
  const delayMs = actualArrival.getTime() - scheduled.getTime();
  return Math.round(delayMs / 1000);
}

/**
 * Calculate delays for multiple arrivals efficiently.
 * Uses 3-tier fallback for maximum match rate.
 *
 * @param arrivals - Array of arrival events (now includes routeId for fallback)
 * @returns Map of arrival index to delay seconds
 */
export async function calculateDelaysBatch(
  arrivals: Array<{ tripId: string; stationId: string; predictedArrival: Date; routeId?: string }>
): Promise<Map<number, number>> {
  await loadScheduleData();

  const results = new Map<number, number>();

  for (let i = 0; i < arrivals.length; i++) {
    const arr = arrivals[i];
    const delay = await calculateDelay(arr.tripId, arr.stationId, arr.predictedArrival, arr.routeId);
    if (delay !== null) {
      results.set(i, delay);
    }
  }

  return results;
}

/**
 * Clear all caches (for testing or memory management).
 */
export function clearScheduleCache(): void {
  scheduleCache = null;
  shapeScheduleIndex = null;
  directionScheduleIndex = null;
  tripRouteCache = null;
  loadingPromise = null;
}
