/**
 * DynamoDB batch writer for analytics records.
 *
 * Handles BatchWriteItem with chunking (25 per batch) and
 * exponential backoff retry for unprocessed items.
 */
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoClient } from '../lib/dynamodb.js';

const METRICS_TABLE = process.env.DYNAMODB_TABLE_METRICS ?? 'railtime-metrics';
const EVENTS_TABLE = process.env.DYNAMODB_TABLE_EVENTS ?? 'railtime-events';
const ROLLUPS_TABLE = process.env.DYNAMODB_TABLE_ROLLUPS ?? 'railtime-rollups';
const BATCH_SIZE = 25; // DynamoDB limit
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

export interface MetricRecord {
  routeId: string;
  direction: string | null; // "N" or "S"
  timestamp: number;
  trainCount: number;
  avgDelaySeconds: number | null;
  onTimePercent: number | null;
  headwayAvgSeconds: number | null;
  feedLatencyMs: number | null;
  feedStatus: string;
  expireAt: number;
}

export interface EventRecord {
  pk: string;
  timestamp: number;
  tripId?: string;
  stationId?: string;
  stationName?: string;
  delaySeconds?: number;
  alertId?: string;
  severity?: string;
  description?: string;
  expireAt: number;
}

export interface RollupRecord {
  routeId: string;
  date: string; // "YYYY-MM-DD#direction" e.g. "2026-02-22#N"
  direction: string | null; // "N" or "S" (also stored as attribute for easier reads)
  avgDelay: number | null;
  onTimePercent: number | null;
  peakTrainCount: number;
  totalAlerts: number;
  avgHeadway: number | null;
  medianHeadway: number | null;
  totalBunching: number;
  totalGaps: number;
  totalSkippedStops: number;
  totalTrips: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function batchWrite(
  tableName: string,
  items: Record<string, unknown>[],
): Promise<void> {
  const client = getDynamoClient();
  if (!client) return;

  const batches = chunk(items, BATCH_SIZE);

  for (const batch of batches) {
    const requests = batch.map((item) => ({
      PutRequest: { Item: item },
    }));

    let unprocessed = { [tableName]: requests };
    let retries = 0;

    while (Object.keys(unprocessed).length > 0 && retries < MAX_RETRIES) {
      const cmd = new BatchWriteCommand({
        RequestItems: unprocessed,
      });

      const result = await client.send(cmd);

      const remaining = result.UnprocessedItems ?? {};
      if (
        Object.keys(remaining).length === 0 ||
        !remaining[tableName]?.length
      ) {
        break;
      }

      unprocessed = remaining as typeof unprocessed;
      retries++;
      await sleep(Math.pow(2, retries) * 100);
    }

    if (retries >= MAX_RETRIES) {
      const remaining = unprocessed[tableName]?.length ?? 0;
      console.error(
        `[dynamodb-writer] ${tableName}: ${remaining} items still unprocessed after ${MAX_RETRIES} retries — escalating`,
      );
      throw new Error(
        `[dynamodb-writer] ${tableName}: ${remaining} items unprocessed after ${MAX_RETRIES} retries`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function writeMetrics(records: MetricRecord[]): Promise<void> {
  if (records.length === 0) return;
  await batchWrite(METRICS_TABLE, records as unknown as Record<string, unknown>[]);
}

export async function writeEvents(records: EventRecord[]): Promise<void> {
  if (records.length === 0) return;
  await batchWrite(EVENTS_TABLE, records as unknown as Record<string, unknown>[]);
}

export async function writeRollups(records: RollupRecord[]): Promise<void> {
  if (records.length === 0) return;
  await batchWrite(ROLLUPS_TABLE, records as unknown as Record<string, unknown>[]);
}
