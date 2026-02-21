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
  type MetricRecord,
  type EventRecord,
} from './dynamodb-writer.js';
import { getDynamoClient } from '../lib/dynamodb.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TTL_DAYS = 7;
const ON_TIME_THRESHOLD_SECONDS = 300; // MTA standard: < 5 min = on time

// ---------------------------------------------------------------------------
// In-memory buffer
// ---------------------------------------------------------------------------

interface RouteBuffer {
  trainCounts: number[];
  delays: number[];
  headways: number[];
  feedLatencies: number[];
  feedStatuses: string[];
}

const buffers = new Map<string, RouteBuffer>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getOrCreateBuffer(routeId: string): RouteBuffer {
  let buf = buffers.get(routeId);
  if (!buf) {
    buf = {
      trainCounts: [],
      delays: [],
      headways: [],
      feedLatencies: [],
      feedStatuses: [],
    };
    buffers.set(routeId, buf);
  }
  return buf;
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

  // Group trains by routeId
  const byRoute = new Map<string, TrainPosition[]>();
  for (const t of trains) {
    const arr = byRoute.get(t.routeId) || [];
    arr.push(t);
    byRoute.set(t.routeId, arr);
  }

  // Group entities by routeId for delay extraction
  const entitiesByRoute = new Map<string, FeedEntity[]>();
  for (const e of entities) {
    if (!e.routeId) continue;
    const arr = entitiesByRoute.get(e.routeId) || [];
    arr.push(e);
    entitiesByRoute.set(e.routeId, arr);
  }

  // Accumulate per route
  for (const [routeId, routeTrains] of byRoute) {
    const buf = getOrCreateBuffer(routeId);
    buf.trainCounts.push(routeTrains.length);
    buf.feedLatencies.push(latencyMs);
    buf.feedStatuses.push(status);

    // Extract delays from stop updates
    const routeEntities = entitiesByRoute.get(routeId) || [];
    for (const entity of routeEntities) {
      for (const su of entity.stopUpdates) {
        if (su.arrival?.delay != null) {
          buf.delays.push(su.arrival.delay);
        }
      }
    }

    // Calculate headways (inter-train gap at next stops)
    if (routeTrains.length >= 2) {
      const sorted = [...routeTrains].sort(
        (a, b) => a.nextTimeMs - b.nextTimeMs,
      );
      for (let i = 1; i < sorted.length; i++) {
        const gap = (sorted[i].nextTimeMs - sorted[i - 1].nextTimeMs) / 1000;
        if (gap > 0 && gap < 3600) {
          buf.headways.push(gap);
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

  for (const alert of alerts) {
    if (alert.severity === 'critical' || alert.severity === 'warning') {
      for (const routeId of alert.affectedRoutes) {
        events.push({
          pk: `ALERT#${routeId}`,
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
  const expireAt = Math.floor(now / 1000) + TTL_DAYS * 86400;
  const metrics: MetricRecord[] = [];
  const delayEvents: EventRecord[] = [];

  for (const [routeId, buf] of buffers) {
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
      routeId,
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

    // Create one delay event per route if significant delays observed
    const significantDelays = buf.delays.filter(
      (d) => d > ON_TIME_THRESHOLD_SECONDS,
    );
    if (significantDelays.length > 0) {
      delayEvents.push({
        pk: `DELAY#${routeId}`,
        timestamp: now,
        delaySeconds: Math.round(Math.max(...significantDelays)),
        expireAt,
      });
    }
  }

  // Clear buffers before async write
  buffers.clear();

  try {
    await Promise.all([
      writeMetrics(metrics),
      delayEvents.length > 0 ? writeEvents(delayEvents) : Promise.resolve(),
    ]);
    console.log(
      `[metrics-collector] Flushed ${metrics.length} metrics, ${delayEvents.length} delay events`,
    );
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
