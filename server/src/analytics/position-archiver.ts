/**
 * Position Archiver
 *
 * Buffers train positions from the feed loop and periodically flushes them
 * to S3 as gzipped NDJSON files partitioned by date/hour. Designed for
 * downstream analytics (Athena, Glue, SageMaker).
 *
 * Graceful degradation: if S3 is not configured, all functions are no-ops.
 * If an upload fails, the data is lost for that cycle (buffer was already
 * swapped), but the error is logged and the archiver continues.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { getS3Client, getAnalyticsBucket } from '../lib/s3.js';
import { createLogger } from '../lib/logger.js';
import type { TrainPosition } from '../types.js';

const log = createLogger('archiver');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// In-memory buffer
// ---------------------------------------------------------------------------

let buffer = new Map<string, TrainPosition[]>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Public API: buffer positions (synchronous, fast)
// ---------------------------------------------------------------------------

/**
 * Add train positions to the archive buffer. Called from the hot feed-loop
 * path on every poll cycle. This function is synchronous and returns
 * immediately; actual S3 writes happen on the flush timer.
 */
export function archivePositions(feedGroupId: string, trains: TrainPosition[]): void {
  if (!getS3Client()) return;
  if (trains.length === 0) return;

  const existing = buffer.get(feedGroupId);
  if (existing) {
    existing.push(...trains);
  } else {
    buffer.set(feedGroupId, [...trains]);
  }
}

// ---------------------------------------------------------------------------
// Flush: snapshot buffer, build NDJSON, gzip, upload to S3
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  const client = getS3Client();
  const bucket = getAnalyticsBucket();
  if (!client || !bucket) return;

  // Atomic swap: grab current buffer and replace with a fresh one.
  // This avoids any race with archivePositions() calls during flush.
  const snapshot = buffer;
  buffer = new Map();

  if (snapshot.size === 0) return;

  const now = Date.now();
  const utcDate = new Date(now);
  const year = utcDate.getUTCFullYear().toString();
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utcDate.getUTCDate()).padStart(2, '0');
  const hour = String(utcDate.getUTCHours()).padStart(2, '0');

  let totalRecords = 0;

  for (const [feedGroupId, trains] of snapshot) {
    // Build NDJSON: one JSON line per position, enriched with metadata
    const lines: string[] = [];
    for (const train of trains) {
      lines.push(JSON.stringify({
        ...train,
        feedGroupId,
        capturedAt: now,
      }));
    }

    const ndjson = lines.join('\n') + '\n';
    const compressed = gzipSync(Buffer.from(ndjson, 'utf-8'));

    const key = `raw/positions/year=${year}/month=${month}/day=${day}/hour=${hour}/${now}-${randomUUID()}.ndjson.gz`;

    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: compressed,
        ContentEncoding: 'gzip',
        ContentType: 'application/x-ndjson',
      }));

      totalRecords += trains.length;
      log.info({
        feedGroupId,
        records: trains.length,
        key,
        compressedBytes: compressed.byteLength,
      }, 'archived positions to S3');
    } catch (err) {
      log.error({
        err: err instanceof Error ? err.message : err,
        feedGroupId,
        records: trains.length,
        key,
      }, 'S3 upload failed — positions dropped for this cycle');
    }
  }

  if (totalRecords > 0) {
    log.info({ totalRecords, feedGroups: snapshot.size }, 'flush complete');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic flush timer. No-op if S3 is not configured.
 */
export function startArchiver(): void {
  if (!getS3Client()) {
    log.info('S3 not configured — position archiving disabled');
    return;
  }

  flushTimer = setInterval(() => {
    flush().catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'flush error'),
    );
  }, FLUSH_INTERVAL_MS);

  log.info({ flushIntervalMs: FLUSH_INTERVAL_MS }, 'archiver started');
}

/**
 * Stop the archiver and flush any remaining buffered data.
 */
export async function stopArchiver(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
  log.info('archiver stopped');
}
