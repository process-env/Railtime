/**
 * Analytics Metrics Collector
 *
 * Hooks into the feed-loop and alert-loop callbacks to accumulate
 * per-route metrics in memory. Flushes to DynamoDB every 5 minutes.
 *
 * Graceful degradation: if DynamoDB is not configured, all functions
 * are no-ops.
 */
import type { TrainPosition, FeedEntity, ServiceAlert } from '../types.js';
import {
  writeMetrics,
  writeEvents,
  writeRollups,
  type MetricRecord,
  type EventRecord,
  type RollupRecord,
} from './dynamodb-writer.js';
import { getDynamoClient } from '../lib/dynamodb.js';
import { computeDeviation } from './schedule-lookup.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TTL_DAYS = 7;
const ON_TIME_THRESHOLD_SECONDS = 300; // MTA standard: < 5 min = on time
const BUNCHING_THRESHOLD_SECONDS = 120; // < 2 min = bunched
const GAP_THRESHOLD_SECONDS = 900; // > 15 min = service gap

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
}

const buffers = new Map<string, RouteBuffer>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let firstDelayLogDone = false;

interface DailyAccum {
  date: string;
  direction: string; // "N", "S", or "X"
  allDelays: number[];
  allHeadways: number[];
  peakTrainCount: number;
  totalAlerts: number;
  totalBunching: number;
  totalGaps: number;
  totalSkippedStops: number;
  flushCount: number;
  totalTrains: number;
}

const dailyAccum = new Map<string, DailyAccum>();
let dailyAccumDate = '';

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
    };
    buffers.set(routeId, buf);
  }
  return buf;
}

function getUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
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
      allDelays: [],
      allHeadways: [],
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
    for (const times of byStop.values()) {
      if (times.length < 2) continue;
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        const gap = (times[i] - times[i - 1]) / 1000;
        if (gap > 0 && gap < 3600) {
          buf.headways.push(gap);
          if (gap < BUNCHING_THRESHOLD_SECONDS) {
            buf.bunchingCount++;
          } else if (gap > GAP_THRESHOLD_SECONDS) {
            buf.gapCount++;
          }
        }
      }
    }

    // Detect skipped stops (Phase 5)
    for (const entity of routeEntities) {
      for (const su of entity.stopUpdates) {
        if (su.scheduleRelationship === 'SKIPPED') {
          const today = getUtcDateString();
          const accum = getOrCreateDailyAccum(key, today);
          accum.totalSkippedStops++;
        }
      }
    }
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
      console.error(
        '[metrics-collector] Failed to write alert events:',
        err instanceof Error ? err.message : err,
      ),
    );
  }

  const today = getUtcDateString();
  for (const alert of alerts) {
    if (alert.affectedRoutes.length > 0) {
      for (const routeId of alert.affectedRoutes) {
        for (const dir of ['N', 'S']) {
          const accum = getOrCreateDailyAccum(`${routeId}#${dir}`, today);
          accum.totalAlerts++;
        }
      }
    }
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

  const now = Date.now();
  const today = getUtcDateString();
  const expireAt = Math.floor(now / 1000) + TTL_DAYS * 86400;
  const metrics: MetricRecord[] = [];
  const delayEvents: EventRecord[] = [];

  // Reset daily accumulator on day change
  if (dailyAccumDate !== today) {
    dailyAccum.clear();
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
      delayEvents.push({
        pk: `DELAY#${routeId}${dirValue ? `#${dirValue}` : ''}`,
        timestamp: now,
        delaySeconds: Math.round(Math.max(...significantDelays)),
        expireAt,
      });
    }

    // Generate bunching events (Phase 5)
    if (buf.bunchingCount > 0) {
      delayEvents.push({
        pk: `BUNCH#${routeId}${dirValue ? `#${dirValue}` : ''}`,
        timestamp: now,
        description: `${buf.bunchingCount} bunching instances detected`,
        expireAt,
      });
    }

    // Generate gap events (Phase 5)
    if (buf.gapCount > 0) {
      delayEvents.push({
        pk: `GAP#${routeId}${dirValue ? `#${dirValue}` : ''}`,
        timestamp: now,
        description: `${buf.gapCount} service gaps detected`,
        expireAt,
      });
    }

    // Merge into daily accumulator (keyed by composite key)
    const accum = getOrCreateDailyAccum(key, today);
    accum.allDelays.push(...buf.delays);
    accum.allHeadways.push(...buf.headways);
    accum.peakTrainCount = Math.max(accum.peakTrainCount, trainCount);
    accum.totalBunching += buf.bunchingCount;
    accum.totalGaps += buf.gapCount;
    accum.flushCount++;
    accum.totalTrains += trainCount;
  }

  // Compute daily rollup records from accumulator
  const rollups: RollupRecord[] = [];
  for (const [key, accum] of dailyAccum) {
    const [routeId, direction] = key.split('#');
    const dirValue = direction === 'X' ? null : direction;
    // Encode direction in SK: "YYYY-MM-DD#N" or just "YYYY-MM-DD" if no direction
    const dateSk = dirValue ? `${today}#${dirValue}` : today;

    const rollupAvgDelay = mean(accum.allDelays);
    const rollupOnTimeCount = accum.allDelays.filter(
      (d) => Math.abs(d) < ON_TIME_THRESHOLD_SECONDS,
    ).length;
    const rollupOnTimePercent =
      accum.allDelays.length > 0
        ? (rollupOnTimeCount / accum.allDelays.length) * 100
        : null;

    const avgHeadwayVal = mean(accum.allHeadways);
    const medianHeadwayVal = median(accum.allHeadways);

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
      console.log(`[metrics-collector] Delay diagnostic: ${totalDelays}/${metrics.length} routes have delay data, sample values: ${delayValues.slice(0, 5).join(', ')}s`);
      firstDelayLogDone = true;
    }
  }

  // Clear buffers before async write
  buffers.clear();

  try {
    await Promise.all([
      writeMetrics(metrics),
      delayEvents.length > 0 ? writeEvents(delayEvents) : Promise.resolve(),
      rollups.length > 0 ? writeRollups(rollups) : Promise.resolve(),
    ]);
    const anomalyEvents = delayEvents.filter(e => e.pk.startsWith('BUNCH#') || e.pk.startsWith('GAP#')).length;
    console.log(
      `[metrics-collector] Flushed ${metrics.length} metrics, ${delayEvents.length} events (${anomalyEvents} anomalies)`,
    );
    if (rollups.length > 0) {
      console.log(
        `[metrics-collector] Updated daily rollups for ${rollups.length} routes`,
      );
    }
  } catch (err) {
    console.error(
      '[metrics-collector] Flush error:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic flush timer. No-op if DynamoDB is not configured.
 */
export function startCollector(): void {
  if (!getDynamoClient()) {
    console.log(
      '[metrics-collector] DynamoDB not configured — analytics collection disabled',
    );
    return;
  }

  flushTimer = setInterval(() => {
    flush().catch((err) =>
      console.error('[metrics-collector] Flush error:', err),
    );
  }, FLUSH_INTERVAL_MS);

  console.log(
    `[metrics-collector] Started (flush every ${FLUSH_INTERVAL_MS / 1000}s)`,
  );
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
  console.log('[metrics-collector] Stopped');
}
