/**
 * Analytics Metrics Collector
 *
 * Hooks into the feed-loop and alert-loop callbacks to accumulate
 * per-route metrics in memory. Flushes to DynamoDB every 5 minutes.
 *
 * Graceful degradation: if DynamoDB is not configured, all functions
 * are no-ops.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TrainPosition, FeedEntity, ServiceAlert, AlertSummary } from '../types.js';
import {
  writeMetrics,
  writeEvents,
  writeRollups,
  type MetricRecord,
  type EventRecord,
  type RollupRecord,
} from './dynamodb-writer.js';
import { getDynamoClient } from '../lib/dynamodb.js';
import { getRedisClient } from '../lib/redis.js';
import { CACHE_KEYS } from '../lib/cache-keys.js';
import { computeDeviation } from './schedule-lookup.js';
import { generateAnalysis } from './transit-analyzer.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('metrics');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TTL_DAYS = 7;
const ON_TIME_THRESHOLD_SECONDS = 300; // MTA standard: < 5 min = on time
const BUNCHING_THRESHOLD_SECONDS = 120; // < 2 min = bunched
const GAP_THRESHOLD_SECONDS = 900; // > 15 min = service gap

// Route-to-feed-group mapping (mirrors FEED_GROUPS in feed-loop.ts)
const ROUTE_TO_FEED_GROUP: Record<string, string> = {
  A: 'ACE', C: 'ACE', E: 'ACE',
  B: 'BDFM', D: 'BDFM', F: 'BDFM', M: 'BDFM',
  G: 'G',
  J: 'JZ', Z: 'JZ',
  N: 'NQRW', Q: 'NQRW', R: 'NQRW', W: 'NQRW',
  L: 'L',
  SI: 'SI', SIR: 'SI',
  S: '1234567',
  '1': '1234567', '2': '1234567', '3': '1234567', '4': '1234567',
  '5': '1234567', '6': '1234567', '7': '1234567',
};

function getFeedGroupForRoute(routeId: string): string {
  return ROUTE_TO_FEED_GROUP[routeId] ?? 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDirection(stopId: string): string | null {
  if (!stopId) return null;
  const last = stopId.charAt(stopId.length - 1);
  if (last === 'N') return 'N';
  if (last === 'S') return 'S';
  return null;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mostCommon(arr: string[]): string | null {
  if (arr.length === 0) return null;
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  let maxItem = arr[0];
  let maxCount = 0;
  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxItem = item;
    }
  }
  return maxItem;
}

// ---------------------------------------------------------------------------
// Stop name lookup
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '..', 'public', 'data');

// Stop ID → station name lookup (loaded from stops.txt)
const stopNameMap = new Map<string, string>();

async function loadStopNames(): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'stops.txt'), 'utf-8');
    const lines = raw.split('\n');
    // Header: stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length >= 2) {
        stopNameMap.set(cols[0].trim(), cols[1].trim());
      }
    }
    log.info({ stops: stopNameMap.size }, 'stop names loaded');
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'failed to load stop names');
  }
}

function getStopName(stopId: string): string {
  // Try exact match first, then parent station (strip N/S suffix)
  const name = stopNameMap.get(stopId);
  if (name) return name;
  const parentId = stopId.replace(/[NS]$/, '');
  return stopNameMap.get(parentId) ?? stopId;
}

// ---------------------------------------------------------------------------
// In-memory buffer
// ---------------------------------------------------------------------------

interface RouteBuffer {
  trainCounts: number[];
  delays: number[];
  headways: number[];
  feedLatencies: number[];
  feedStatuses: string[];
  bunchingCount: number;
  gapCount: number;
  bunchingStops: string[];  // stop IDs where bunching detected
  gapStops: string[];       // stop IDs where gaps detected
  worstDelayStopId: string | null;  // stop with worst delay
  worstDelaySeconds: number;        // worst delay value
}

const buffers = new Map<string, RouteBuffer>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let firstDelayLogDone = false;
let flushing = false;
let activeAlertCount = 0;
let latestAlertDetails: AlertSummary[] = [];

// ---------------------------------------------------------------------------
// Trip lifecycle tracking
// ---------------------------------------------------------------------------

interface ActiveTrip {
  tripId: string;
  routeId: string;
  direction: string;
  startedAt: number;      // epoch ms
  lastSeenAt: number;     // epoch ms
  stopsServed: number;    // count of unique stop IDs visited
  lastStopId: string;
  visitedStops: Set<string>; // track unique stops
}

const activeTripMap = new Map<string, ActiveTrip>();

interface DailyAccum {
  date: string;
  direction: string; // "N", "S", or "X"
  // Running delay counters (replaces unbounded allDelays array)
  sumDelays: number;
  countDelays: number;
  sumOnTime: number; // count of delays where |d| < ON_TIME_THRESHOLD_SECONDS
  // Running headway counters (replaces unbounded allHeadways array)
  sumHeadways: number;
  countHeadways: number;
  // Reservoir sampling for median headway (~1000 samples)
  headwayReservoir: number[];
  headwayReservoirCount: number; // total items seen (for reservoir probability)
  peakTrainCount: number;
  totalAlerts: number;
  totalBunching: number;
  totalGaps: number;
  totalSkippedStops: number;
  flushCount: number;
  totalTrains: number;
}

const RESERVOIR_SIZE = 1000;

const dailyAccum = new Map<string, DailyAccum>();
let dailyAccumDate = '';
let dailyAlertIds = new Map<string, Set<string>>(); // routeId -> Set<alertId>

function getOrCreateBuffer(routeId: string): RouteBuffer {
  let buf = buffers.get(routeId);
  if (!buf) {
    buf = {
      trainCounts: [],
      delays: [],
      headways: [],
      feedLatencies: [],
      feedStatuses: [],
      bunchingCount: 0,
      gapCount: 0,
      bunchingStops: [],
      gapStops: [],
      worstDelayStopId: null,
      worstDelaySeconds: 0,
    };
    buffers.set(routeId, buf);
  }
  return buf;
}

function getNycDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date()); // "YYYY-MM-DD"
}

function getOrCreateDailyAccum(compositeKey: string, date: string): DailyAccum {
  let accum = dailyAccum.get(compositeKey);
  if (!accum) {
    const direction = compositeKey.includes('#')
      ? compositeKey.split('#')[1]
      : 'X';
    accum = {
      date,
      direction,
      sumDelays: 0,
      countDelays: 0,
      sumOnTime: 0,
      sumHeadways: 0,
      countHeadways: 0,
      headwayReservoir: [],
      headwayReservoirCount: 0,
      peakTrainCount: 0,
      totalAlerts: 0,
      totalBunching: 0,
      totalGaps: 0,
      totalSkippedStops: 0,
      flushCount: 0,
      totalTrains: 0,
    };
    dailyAccum.set(compositeKey, accum);
  }
  return accum;
}

// ---------------------------------------------------------------------------
// Feed-loop integration
// ---------------------------------------------------------------------------

/**
 * Called from the feed-loop callback on every 15s poll cycle.
 * Accumulates per-route metrics into the in-memory buffer.
 */
export function collectMetrics(
  _feedGroupId: string,
  trains: TrainPosition[],
  entities: FeedEntity[],
  latencyMs: number,
  status: 'success' | 'error' | 'timeout',
): void {
  if (!getDynamoClient()) return;

  // Group trains by routeId#direction
  const byRouteDir = new Map<string, TrainPosition[]>();
  for (const t of trains) {
    const dir = getDirection(t.nextStopId) ?? 'X';
    const key = `${t.routeId}#${dir}`;
    const arr = byRouteDir.get(key) || [];
    arr.push(t);
    byRouteDir.set(key, arr);
  }

  // Group entities by routeId#direction for delay extraction
  const entitiesByRouteDir = new Map<string, FeedEntity[]>();
  for (const e of entities) {
    if (!e.routeId) continue;
    const firstStop = e.stopUpdates[0]?.stopId;
    const dir = firstStop ? (getDirection(firstStop) ?? 'X') : 'X';
    const key = `${e.routeId}#${dir}`;
    const arr = entitiesByRouteDir.get(key) || [];
    arr.push(e);
    entitiesByRouteDir.set(key, arr);
  }

  // Accumulate per route+direction
  for (const [key, routeTrains] of byRouteDir) {
    const buf = getOrCreateBuffer(key); // Use composite key
    buf.trainCounts.push(routeTrains.length);
    buf.feedLatencies.push(latencyMs);
    buf.feedStatuses.push(status);

    // Compute real delays via schedule deviation (Phase 3)
    const routeEntities = entitiesByRouteDir.get(key) || [];
    for (const entity of routeEntities) {
      if (!entity.tripId) continue;
      for (const su of entity.stopUpdates) {
        if (!su.stopId || !su.arrival?.time) continue;
        const deviation = computeDeviation(entity.tripId, su.stopId, su.arrival.time);
        if (deviation !== null) {
          buf.delays.push(deviation);
          if (deviation > buf.worstDelaySeconds) {
            buf.worstDelaySeconds = deviation;
            buf.worstDelayStopId = su.stopId;
          }
        }
      }
    }

    // Calculate headway: gap between successive trains at the same stop
    const byStop = new Map<string, number[]>();
    for (const t of routeTrains) {
      if (!t.nextStopId || !t.nextTimeMs) continue;
      const times = byStop.get(t.nextStopId) || [];
      times.push(t.nextTimeMs);
      byStop.set(t.nextStopId, times);
    }
    for (const [stopId, times] of byStop) {
      if (times.length < 2) continue;
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        const gap = (times[i] - times[i - 1]) / 1000;
        if (gap > 0 && gap < 3600) {
          buf.headways.push(gap);
          if (gap < BUNCHING_THRESHOLD_SECONDS) {
            buf.bunchingCount++;
            buf.bunchingStops.push(stopId);
          } else if (gap > GAP_THRESHOLD_SECONDS) {
            buf.gapCount++;
            buf.gapStops.push(stopId);
          }
        }
      }
    }

    // Detect skipped stops (Phase 5)
    for (const entity of routeEntities) {
      for (const su of entity.stopUpdates) {
        if (su.scheduleRelationship === 'SKIPPED') {
          const today = getNycDateString();
          const accum = getOrCreateDailyAccum(key, today);
          accum.totalSkippedStops++;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Trip lifecycle tracking — detect new trips and update existing ones
  // -------------------------------------------------------------------------

  const now = Date.now();
  const expireAt = Math.floor(now / 1000) + TTL_DAYS * 86400;
  const tripStartEvents: EventRecord[] = [];
  let startEventCounter = 0;

  for (const train of trains) {
    const direction = getDirection(train.nextStopId) ?? 'X';

    if (!activeTripMap.has(train.tripId)) {
      // New trip — create entry and queue TRIP_START event
      activeTripMap.set(train.tripId, {
        tripId: train.tripId,
        routeId: train.routeId,
        direction,
        startedAt: now,
        lastSeenAt: now,
        stopsServed: train.nextStopId ? 1 : 0,
        lastStopId: train.nextStopId,
        visitedStops: train.nextStopId ? new Set([train.nextStopId]) : new Set(),
      });

      tripStartEvents.push({
        pk: `TRIP_START#${train.routeId}#${direction}`,
        timestamp: now + startEventCounter++,
        tripId: train.tripId,
        expireAt,
      });
    } else {
      // Existing trip — update tracking state
      const trip = activeTripMap.get(train.tripId)!;
      trip.lastSeenAt = now;
      trip.lastStopId = train.nextStopId;
      if (train.nextStopId) {
        trip.visitedStops.add(train.nextStopId);
        trip.stopsServed = trip.visitedStops.size;
      }
    }
  }

  // Write TRIP_START events immediately (low volume, time-sensitive)
  if (tripStartEvents.length > 0) {
    writeEvents(tripStartEvents).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'failed to write trip start events'),
    );
  }
}

// ---------------------------------------------------------------------------
// Alert-loop integration
// ---------------------------------------------------------------------------

/**
 * Called from the alert-loop callback. Creates event records for
 * critical/warning alerts.
 */
export function collectAlertEvent(alerts: ServiceAlert[]): void {
  // Always track count even if DynamoDB is not configured (used by SYSTEM_HEALTH)
  activeAlertCount = alerts.length;
  latestAlertDetails = alerts.map(a => ({
    id: a.id,
    headerText: a.headerText,
    affectedRoutes: a.affectedRoutes,
  }));
  if (!getDynamoClient()) return;

  const now = Date.now();
  const expireAt = Math.floor(now / 1000) + TTL_DAYS * 86400;
  const events: EventRecord[] = [];

  const seenPks = new Set<string>();
  for (const alert of alerts) {
    if (alert.affectedRoutes.length > 0) {
      for (const routeId of alert.affectedRoutes) {
        const pk = `ALERT#${routeId}`;
        if (seenPks.has(pk)) continue;
        seenPks.add(pk);
        events.push({
          pk,
          timestamp: now,
          alertId: alert.id,
          severity: alert.severity,
          description: alert.headerText.slice(0, 200),
          expireAt,
        });
      }
    }
  }

  if (events.length > 0) {
    writeEvents(events).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'failed to write alert events'),
    );
  }

  // Track unique alert IDs per route to avoid double-counting
  const today = getNycDateString();
  for (const alert of alerts) {
    if (alert.affectedRoutes.length > 0) {
      for (const routeId of alert.affectedRoutes) {
        let ids = dailyAlertIds.get(routeId);
        if (!ids) { ids = new Set(); dailyAlertIds.set(routeId, ids); }
        ids.add(alert.id);
        // Update both direction accums with the TOTAL unique count
        for (const dir of ['N', 'S']) {
          const accum = getOrCreateDailyAccum(`${routeId}#${dir}`, today);
          accum.totalAlerts = ids.size;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Removed-trip tracking
// ---------------------------------------------------------------------------

/**
 * Called when the feed loop detects trains that disappeared from a feed group.
 * Logs TRIP_END events for trips that were being tracked in the activeTripMap.
 */
export function collectRemovedTrips(feedGroupId: string, removedTripIds: string[]): void {
  if (!getDynamoClient()) return;
  if (removedTripIds.length === 0) return;

  const now = Date.now();
  const expireAt = Math.floor(now / 1000) + TTL_DAYS * 86400;
  const events: EventRecord[] = [];
  let endEventCounter = 0;

  for (const tripId of removedTripIds) {
    const trip = activeTripMap.get(tripId);
    if (!trip) continue;

    const duration = Math.round((trip.lastSeenAt - trip.startedAt) / 1000); // seconds

    events.push({
      pk: `TRIP_END#${trip.routeId}#${trip.direction}`,
      timestamp: now + endEventCounter++,
      tripId,
      description: JSON.stringify({
        routeId: trip.routeId,
        direction: trip.direction,
        duration,
        stopsServed: trip.visitedStops.size,
        startedAt: trip.startedAt,
        endedAt: now,
      }),
      expireAt,
    });

    activeTripMap.delete(tripId);
  }

  if (events.length > 0) {
    writeEvents(events).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'failed to write trip end events'),
    );
    log.info({ tripEnds: events.length, feedGroupId }, 'trip end events recorded');
  }
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

function mean(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function flush(): Promise<void> {
  if (!getDynamoClient()) return;
  if (buffers.size === 0) return;
  if (flushing) {
    log.warn('flush already in progress, skipping');
    return;
  }
  flushing = true;

  const now = Date.now();
  const today = getNycDateString();
  const expireAt = Math.floor(now / 1000) + TTL_DAYS * 86400;
  const metrics: MetricRecord[] = [];
  const delayEvents: EventRecord[] = [];

  // Reset daily accumulator on day change
  if (dailyAccumDate !== today) {
    dailyAccum.clear();
    dailyAlertIds = new Map();
    dailyAccumDate = today;
  }

  for (const [key, buf] of buffers) {
    const [routeId, direction] = key.split('#');
    const dirValue = direction === 'X' ? null : direction;

    const trainCount =
      buf.trainCounts.length > 0
        ? Math.round(
            buf.trainCounts.reduce((a, b) => a + b, 0) /
              buf.trainCounts.length,
          )
        : 0;

    const avgDelay = mean(buf.delays);
    const onTimeCount = buf.delays.filter(
      (d) => Math.abs(d) < ON_TIME_THRESHOLD_SECONDS,
    ).length;
    const onTimePercent =
      buf.delays.length > 0
        ? (onTimeCount / buf.delays.length) * 100
        : null;

    const avgHeadway = mean(buf.headways);
    const avgLatency =
      buf.feedLatencies.length > 0
        ? Math.round(
            buf.feedLatencies.reduce((a, b) => a + b, 0) /
              buf.feedLatencies.length,
          )
        : null;

    const lastStatus =
      buf.feedStatuses.length > 0
        ? buf.feedStatuses[buf.feedStatuses.length - 1]
        : 'unknown';

    metrics.push({
      routeId: dirValue ? `${routeId}#${dirValue}` : routeId,
      direction: dirValue,
      timestamp: now,
      trainCount,
      avgDelaySeconds:
        avgDelay != null ? Math.round(avgDelay * 10) / 10 : null,
      onTimePercent:
        onTimePercent != null ? Math.round(onTimePercent * 10) / 10 : null,
      headwayAvgSeconds: avgHeadway != null ? Math.round(avgHeadway) : null,
      feedLatencyMs: avgLatency,
      feedStatus: lastStatus,
      expireAt,
    });

    // Create one delay event per route+direction if significant delays observed
    const significantDelays = buf.delays.filter(
      (d) => d > ON_TIME_THRESHOLD_SECONDS,
    );
    if (significantDelays.length > 0) {
      const maxDelay = Math.round(Math.max(...significantDelays));
      const delayMin = Math.round(maxDelay / 60);
      const locationName = buf.worstDelayStopId ? getStopName(buf.worstDelayStopId) : null;
      delayEvents.push({
        pk: `DELAY#${routeId}${dirValue ? `#${dirValue}` : ''}`,
        timestamp: now,
        delaySeconds: maxDelay,
        description: locationName
          ? `${delayMin}m delay at ${locationName}`
          : `${delayMin}m delay`,
        stopId: buf.worstDelayStopId ?? undefined,
        expireAt,
      });
    }

    // Generate bunching events (Phase 5)
    if (buf.bunchingCount > 0) {
      // Find the most common bunching stop
      const topStop = mostCommon(buf.bunchingStops);
      const locationName = topStop ? getStopName(topStop) : null;
      delayEvents.push({
        pk: `BUNCH#${routeId}${dirValue ? `#${dirValue}` : ''}`,
        timestamp: now,
        description: locationName
          ? `${buf.bunchingCount} bunching at ${locationName}`
          : `${buf.bunchingCount} bunching instances`,
        stopId: topStop ?? undefined,
        expireAt,
      });
    }

    // Generate gap events (Phase 5)
    if (buf.gapCount > 0) {
      const topStop = mostCommon(buf.gapStops);
      const locationName = topStop ? getStopName(topStop) : null;
      delayEvents.push({
        pk: `GAP#${routeId}${dirValue ? `#${dirValue}` : ''}`,
        timestamp: now,
        description: locationName
          ? `${buf.gapCount} service gaps at ${locationName}`
          : `${buf.gapCount} service gaps`,
        stopId: topStop ?? undefined,
        expireAt,
      });
    }

    // Merge into daily accumulator (keyed by composite key)
    const accum = getOrCreateDailyAccum(key, today);

    // Running delay counters
    accum.sumDelays += buf.delays.reduce((a, b) => a + b, 0);
    accum.countDelays += buf.delays.length;
    accum.sumOnTime += buf.delays.filter(d => Math.abs(d) < ON_TIME_THRESHOLD_SECONDS).length;

    // Running headway counters + reservoir sampling
    accum.sumHeadways += buf.headways.reduce((a, b) => a + b, 0);
    accum.countHeadways += buf.headways.length;
    for (const h of buf.headways) {
      accum.headwayReservoirCount++;
      if (accum.headwayReservoir.length < RESERVOIR_SIZE) {
        accum.headwayReservoir.push(h);
      } else {
        const j = Math.floor(Math.random() * accum.headwayReservoirCount);
        if (j < RESERVOIR_SIZE) {
          accum.headwayReservoir[j] = h;
        }
      }
    }

    accum.peakTrainCount = Math.max(accum.peakTrainCount, trainCount);
    accum.totalBunching += buf.bunchingCount;
    accum.totalGaps += buf.gapCount;
    accum.flushCount++;
    accum.totalTrains += trainCount;
  }

  // Build per-feed-group breakdown for SYSTEM_HEALTH
  const feedGroupMap = new Map<string, { trainCount: number; latencyMs: number; statuses: string[] }>();
  for (const m of metrics) {
    const routeId = m.routeId.split('#')[0]; // strip direction suffix
    const feedGroupId = getFeedGroupForRoute(routeId);
    if (feedGroupId === 'UNKNOWN') continue;
    const fg = feedGroupMap.get(feedGroupId) ?? { trainCount: 0, latencyMs: 0, statuses: [] };
    fg.trainCount += m.trainCount;
    if (m.feedLatencyMs != null) fg.latencyMs = Math.max(fg.latencyMs, m.feedLatencyMs);
    if (m.feedStatus) fg.statuses.push(m.feedStatus);
    feedGroupMap.set(feedGroupId, fg);
  }

  const feedGroups = Array.from(feedGroupMap.entries()).map(([feedGroupId, data]) => ({
    feedGroupId,
    trainCount: data.trainCount,
    latencyMs: data.latencyMs,
    status: data.statuses.includes('error') ? 'error' : 'ok',
  }));

  // Compute aggregated SYSTEM_HEALTH summary record
  const totalTrains = metrics.reduce((sum, m) => sum + m.trainCount, 0);
  const healthRecord: MetricRecord = {
    routeId: 'SYSTEM_HEALTH',
    direction: null,
    timestamp: now,
    trainCount: totalTrains,
    avgDelaySeconds: null,
    onTimePercent: null,
    headwayAvgSeconds: null,
    feedLatencyMs:
      metrics.length > 0
        ? Math.round(
            metrics.reduce((s, m) => s + (m.feedLatencyMs ?? 0), 0) /
              metrics.length,
          )
        : null,
    feedStatus: metrics.some((m) => m.feedStatus === 'error')
      ? 'degraded'
      : 'ok',
    expireAt,
    feedGroupData: JSON.stringify(feedGroups),
    alertCount: activeAlertCount,
  };
  metrics.push(healthRecord);

  // Compute daily rollup records from accumulator
  const rollups: RollupRecord[] = [];
  for (const [key, accum] of dailyAccum) {
    const [routeId, direction] = key.split('#');
    const dirValue = direction === 'X' ? null : direction;
    // Encode direction in SK: "YYYY-MM-DD#N" or just "YYYY-MM-DD" if no direction
    const dateSk = dirValue ? `${today}#${dirValue}` : today;

    const rollupAvgDelay = accum.countDelays > 0
      ? accum.sumDelays / accum.countDelays
      : null;
    const rollupOnTimePercent = accum.countDelays > 0
      ? (accum.sumOnTime / accum.countDelays) * 100
      : null;

    const avgHeadwayVal = accum.countHeadways > 0
      ? accum.sumHeadways / accum.countHeadways
      : null;
    const medianHeadwayVal = median(accum.headwayReservoir);

    rollups.push({
      routeId,
      date: dateSk,
      direction: dirValue,
      avgDelay:
        rollupAvgDelay != null
          ? Math.round(rollupAvgDelay * 10) / 10
          : null,
      onTimePercent:
        rollupOnTimePercent != null
          ? Math.round(rollupOnTimePercent * 10) / 10
          : null,
      peakTrainCount: accum.peakTrainCount,
      totalAlerts: accum.totalAlerts,
      avgHeadway:
        avgHeadwayVal != null ? Math.round(avgHeadwayVal) : null,
      medianHeadway:
        medianHeadwayVal != null ? Math.round(medianHeadwayVal) : null,
      totalBunching: accum.totalBunching,
      totalGaps: accum.totalGaps,
      totalSkippedStops: accum.totalSkippedStops,
      totalTrips: accum.totalTrains,
    });
  }

  // Delay diagnostic log (Phase 3) — fires once on first flush with delay data
  if (!firstDelayLogDone) {
    const totalDelays = metrics.reduce((sum, m) => sum + (m.avgDelaySeconds != null ? 1 : 0), 0);
    const delayValues = metrics.filter(m => m.avgDelaySeconds != null).map(m => m.avgDelaySeconds);
    if (delayValues.length > 0) {
      log.info({ routesWithDelay: totalDelays, totalRoutes: metrics.length, sampleValues: delayValues.slice(0, 5) }, 'delay diagnostic');
      firstDelayLogDone = true;
    }
  }

  // Clean up stale trips (not seen for 30 min — likely dead/completed trains)
  const STALE_TRIP_THRESHOLD = 30 * 60 * 1000;
  const staleNow = Date.now();
  let staleEventCounter = 0;
  for (const [tripId, trip] of activeTripMap) {
    if (staleNow - trip.lastSeenAt > STALE_TRIP_THRESHOLD) {
      const duration = Math.round((trip.lastSeenAt - trip.startedAt) / 1000);
      delayEvents.push({
        pk: `TRIP_END#${trip.routeId}#${trip.direction}`,
        timestamp: staleNow + staleEventCounter++,
        tripId,
        description: JSON.stringify({
          routeId: trip.routeId,
          direction: trip.direction,
          duration,
          stopsServed: trip.visitedStops.size,
          startedAt: trip.startedAt,
          endedAt: trip.lastSeenAt, // use last seen, not now
          stale: true,
        }),
        expireAt,
      });
      activeTripMap.delete(tripId);
    }
  }

  try {
    await Promise.all([
      writeMetrics(metrics),
      delayEvents.length > 0 ? writeEvents(delayEvents) : Promise.resolve(),
      rollups.length > 0 ? writeRollups(rollups) : Promise.resolve(),
    ]);
    // Clear buffers only after successful write — on failure, data is retained for next flush
    buffers.clear();
    const anomalyEvents = delayEvents.filter(e => e.pk.startsWith('BUNCH#') || e.pk.startsWith('GAP#')).length;
    log.info({ metricsCount: metrics.length, eventsCount: delayEvents.length, anomalies: anomalyEvents }, 'flush complete');
    if (rollups.length > 0) {
      log.info({ rollupsCount: rollups.length }, 'daily rollups updated');
    }

    // Push anomaly events to Redis sorted set for the anomaly feed API
    const anomalyItems = delayEvents.filter(e =>
      e.pk.startsWith('BUNCH#') || e.pk.startsWith('GAP#') || e.pk.startsWith('DELAY#')
    );
    if (anomalyItems.length > 0) {
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          const ANOMALY_KEY = CACHE_KEYS.ANOMALY_FEED;
          const pipeline = redisClient.pipeline();
          for (const event of anomalyItems) {
            pipeline.zadd(ANOMALY_KEY, event.timestamp, JSON.stringify(event));
          }
          // Trim: remove events older than 1 hour
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          pipeline.zremrangebyscore(ANOMALY_KEY, '-inf', oneHourAgo);
          // Cap at 200 entries
          pipeline.zremrangebyrank(ANOMALY_KEY, 0, -201);
          await pipeline.exec();
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : err }, 'failed to push anomaly events to Redis');
        }
      }
    }

    // Generate AI transit analysis — skip if no active trains
    const routeMetrics = metrics.filter(m => m.routeId !== 'SYSTEM_HEALTH');
    if (routeMetrics.length > 0 && routeMetrics.some(m => m.trainCount > 0)) {
      generateAnalysis({
        metrics,
        rollups,
        events: delayEvents,
        alerts: latestAlertDetails,
        systemHealth: healthRecord,
      }).catch(err =>
        log.error({ err: err instanceof Error ? err.message : err }, 'transit analysis generation failed'),
      );
    } else {
      log.debug('skipping analysis — no active trains');
    }
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'flush error');
  } finally {
    flushing = false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic flush timer. No-op if DynamoDB is not configured.
 */
export async function startCollector(): Promise<void> {
  if (!getDynamoClient()) {
    log.info('dynamodb not configured — analytics collection disabled');
    return;
  }

  await loadStopNames();

  flushTimer = setInterval(() => {
    flush().catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'flush error'),
    );
  }, FLUSH_INTERVAL_MS);

  log.info({ flushIntervalMs: FLUSH_INTERVAL_MS }, 'collector started');
}

/**
 * Stop the collector and flush any remaining buffered data.
 */
export async function stopCollector(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
  log.info('stopped');
}
