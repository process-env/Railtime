/**
 * Data Collector Service
 *
 * Collects and stores historical train data for analytics:
 * - Train position snapshots
 * - Arrival predictions
 * - Service alerts
 */

import { db } from '@/lib/db';
import { fetchFeed } from '@/lib/mta/fetch-feed';
import { fetchAlerts } from '@/lib/mta/fetch-alerts';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { FEED_GROUPS } from '@/lib/mta/feed-groups';
import { calculateDelay } from '@/lib/mta/load-schedule';

export interface CollectionResult {
  trainSnapshots: number;
  arrivalEvents: number;
  alertsUpdated: number;
  feedLogs: number;
  duration: number;
  errors: string[];
}

/**
 * Collect train position snapshots from all feeds
 */
export async function collectTrainSnapshots(): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let totalCount = 0;
  const feedTimestamp = new Date();

  for (const group of FEED_GROUPS) {
    try {
      const startTime = Date.now();
      const entities = await fetchFeed(group.id, { useCache: false });
      const latencyMs = Date.now() - startTime;

      // Log feed poll
      await db.feedPollLog.create({
        data: {
          feedGroupId: group.id,
          status: 'success',
          entityCount: entities.length,
          latencyMs,
        },
      });

      // Calculate positions
      const positions = await calculateTrainPositions(entities);

      if (positions.length === 0) continue;

      // Store snapshots
      const snapshots = positions.map((pos) => ({
        tripId: pos.tripId,
        routeId: pos.routeId,
        lat: pos.lat,
        lon: pos.lon,
        heading: pos.heading,
        nextStopId: pos.nextStopId,
        nextStopName: pos.nextStopName,
        etaSeconds: Math.max(0, Math.floor((new Date(pos.eta).getTime() - Date.now()) / 1000)),
        feedGroupId: group.id,
        feedTimestamp,
      }));

      await db.trainSnapshot.createMany({ data: snapshots });
      totalCount += snapshots.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${group.id}: ${message}`);

      // Log failed poll
      await db.feedPollLog.create({
        data: {
          feedGroupId: group.id,
          status: 'error',
          errorMessage: message,
        },
      });
    }
  }

  return { count: totalCount, errors };
}

/**
 * Collect arrival predictions from all feeds
 */
export async function collectArrivalEvents(): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let totalCount = 0;
  const recordedAt = new Date();

  for (const group of FEED_GROUPS) {
    try {
      const entities = await fetchFeed(group.id, { useCache: true }); // Use cached data
      const feedTimestamp = entities[0]?.timestamp
        ? new Date(entities[0].timestamp)
        : recordedAt;

      interface ArrivalData {
        stationId: string;
        routeId: string;
        tripId: string;
        direction: string | null;
        predictedArrival: Date;
        delaySeconds: number | null;
        feedGroupId: string;
        feedTimestamp: Date;
        recordedAt: Date;
      }

      const arrivals: ArrivalData[] = [];

      for (const entity of entities) {
        if (!entity.routeId || !entity.tripId) continue;
        if (!entity.stopUpdates || !Array.isArray(entity.stopUpdates)) continue;

        for (const stop of entity.stopUpdates) {
          if (!stop.stopId || !stop.arrival?.time) continue;

          // Extract direction from stop ID (N or S suffix)
          const direction = stop.stopId.endsWith('N')
            ? 'N'
            : stop.stopId.endsWith('S')
              ? 'S'
              : null;

          const predictedArrival = new Date(stop.arrival.time);

          // Calculate delay from schedule (fall back to GTFS-RT delay if no match)
          let delaySeconds = stop.arrival.delay;
          const calculatedDelay = await calculateDelay(
            entity.tripId,
            stop.stopId,
            predictedArrival
          );
          if (calculatedDelay !== null) {
            delaySeconds = calculatedDelay;
          }

          arrivals.push({
            stationId: stop.stopId,
            routeId: entity.routeId,
            tripId: entity.tripId,
            direction,
            predictedArrival,
            delaySeconds,
            feedGroupId: group.id,
            feedTimestamp,
            recordedAt,
          });
        }
      }

      // Store all arrivals directly (no station validation - IDs are raw GTFS-RT stop IDs)
      if (arrivals.length > 0) {
        await db.arrivalEvent.createMany({ data: arrivals });
        totalCount += arrivals.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${group.id}: ${message}`);
    }
  }

  return { count: totalCount, errors };
}

/**
 * Collect and update service alerts
 */
export async function collectAlerts(): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];

  try {
    const alerts = await fetchAlerts({ useCache: false });
    const now = new Date();

    // Get existing alerts by alertId
    const existingAlerts = await db.alertLog.findMany({
      where: { alertId: { in: alerts.map((a) => a.id) } },
      select: { alertId: true },
    });
    const existingIds = new Set(existingAlerts.map((a: { alertId: string }) => a.alertId));

    // Separate new vs existing
    const newAlerts = alerts.filter((a) => !existingIds.has(a.id));
    const updatedAlerts = alerts.filter((a) => existingIds.has(a.id));

    // Create new alerts
    if (newAlerts.length > 0) {
      await db.alertLog.createMany({
        data: newAlerts.map((alert) => ({
          alertId: alert.id,
          alertType: alert.alertType,
          severity: alert.severity,
          headerText: alert.headerText,
          descriptionText: alert.descriptionHtml,
          affectedRoutes: alert.affectedRoutes,
          affectedStops: alert.affectedStops,
          alertStart: alert.activePeriods[0]?.start
            ? new Date(alert.activePeriods[0].start)
            : null,
          alertEnd: alert.activePeriods[0]?.end
            ? new Date(alert.activePeriods[0].end)
            : null,
          firstSeen: now,
          lastSeen: now,
          isActive: true,
        })),
      });
    }

    // Update existing alerts (mark as seen) - batch update to avoid N+1
    if (updatedAlerts.length > 0) {
      // First, batch update common fields for all updated alerts
      await db.alertLog.updateMany({
        where: { alertId: { in: updatedAlerts.map((a) => a.id) } },
        data: {
          lastSeen: now,
          isActive: true,
        },
      });

      // Then update individual alerts with their specific data using transaction
      await db.$transaction(
        updatedAlerts.map((alert) =>
          db.alertLog.update({
            where: { alertId: alert.id },
            data: {
              headerText: alert.headerText,
              descriptionText: alert.descriptionHtml,
              affectedRoutes: alert.affectedRoutes,
              affectedStops: alert.affectedStops,
            },
          })
        )
      );
    }

    // Mark alerts not in current feed as inactive
    const activeAlertIds = alerts.map((a) => a.id);
    await db.alertLog.updateMany({
      where: {
        isActive: true,
        alertId: { notIn: activeAlertIds },
      },
      data: { isActive: false },
    });

    return { count: newAlerts.length + updatedAlerts.length, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    errors.push(message);
    return { count: 0, errors };
  }
}

/**
 * Run full data collection cycle
 */
export async function runCollection(): Promise<CollectionResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // Run collections in parallel
  const [snapshots, arrivals, alerts] = await Promise.all([
    collectTrainSnapshots(),
    collectArrivalEvents(),
    collectAlerts(),
  ]);

  errors.push(...snapshots.errors, ...arrivals.errors, ...alerts.errors);

  // Get feed log count for this run
  const feedLogs = await db.feedPollLog.count({
    where: {
      createdAt: { gte: new Date(startTime) },
    },
  });

  return {
    trainSnapshots: snapshots.count,
    arrivalEvents: arrivals.count,
    alertsUpdated: alerts.count,
    feedLogs,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Clean up old data to manage database size
 */
export async function cleanupOldData(daysToKeep = 30): Promise<{
  trainSnapshots: number;
  arrivalEvents: number;
  feedLogs: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);

  const [trainSnapshots, arrivalEvents, feedLogs] = await Promise.all([
    db.trainSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    db.arrivalEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    db.feedPollLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return {
    trainSnapshots: trainSnapshots.count,
    arrivalEvents: arrivalEvents.count,
    feedLogs: feedLogs.count,
  };
}
