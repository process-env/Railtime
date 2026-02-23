/**
 * Position Archiver — Unit Tests
 *
 * Verifies buffering, flushing, gzip NDJSON format, S3 key patterns,
 * and graceful no-op behavior when S3 is not configured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { TrainPosition } from '../types.js';

const gunzipAsync = promisify(gunzip);

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import of the module under test
// ---------------------------------------------------------------------------

// Captured PutObjectCommand arguments from mock S3 client
const putCalls: Array<{ Bucket: string; Key: string; Body: Buffer; ContentEncoding: string; ContentType: string }> = [];

// Control whether S3 client is "configured"
let mockS3Client: { send: ReturnType<typeof vi.fn> } | null = null;
let mockBucket: string | null = null;

vi.mock('../lib/s3.js', () => ({
  getS3Client: () => mockS3Client,
  getAnalyticsBucket: () => mockBucket,
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrain(overrides?: Partial<TrainPosition>): TrainPosition {
  return {
    tripId: '001_A..N01R',
    routeId: 'A',
    lat: 40.7128,
    lon: -74.006,
    heading: 180,
    nextStopId: 'A15N',
    nextStopName: 'Chambers St',
    eta: '2m',
    headsign: 'Far Rockaway',
    prevStopId: 'A14N',
    prevTimeMs: 1700000000000,
    nextTimeMs: 1700000120000,
    ...overrides,
  };
}

async function decompressNdjson(gzipped: Buffer): Promise<Record<string, unknown>[]> {
  const raw = await gunzipAsync(gzipped);
  const lines = raw.toString('utf-8').trim().split('\n');
  return lines.map((line) => JSON.parse(line));
}

function enableS3(): void {
  putCalls.length = 0;
  mockS3Client = {
    send: vi.fn(async (cmd: { input: unknown }) => {
      putCalls.push(cmd.input as typeof putCalls[0]);
    }),
  };
  mockBucket = 'test-analytics-bucket';
}

function disableS3(): void {
  mockS3Client = null;
  mockBucket = null;
  putCalls.length = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// We import the module under test dynamically in each `describe` block so that
// the module-level `buffer` Map is fresh. Vitest's module cache is reset via
// `vi.resetModules()`.

describe('position-archiver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    putCalls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    disableS3();
  });

  // -------------------------------------------------------------------------
  // archivePositions
  // -------------------------------------------------------------------------

  describe('archivePositions', () => {
    it('is a no-op when S3 client is null', async () => {
      disableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      // Should not throw, and buffer should remain empty
      archivePositions('ACE', [makeTrain()]);

      // Flush via stopArchiver — nothing should be sent
      enableS3(); // even if we enable S3 after, the buffer was never written
      // Re-disable: actually we want to verify no puts happened at all
      disableS3();
      await stopArchiver();
      expect(putCalls).toHaveLength(0);
    });

    it('adds records to buffer (verified via flush)', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('ACE', [makeTrain(), makeTrain({ tripId: '002_C..N' })]);
      await stopArchiver();

      expect(putCalls).toHaveLength(1);
      const records = await decompressNdjson(putCalls[0].Body);
      expect(records).toHaveLength(2);
    });

    it('skips empty arrays (no buffer entry created)', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('ACE', []);
      await stopArchiver();

      expect(putCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // flush behavior
  // -------------------------------------------------------------------------

  describe('flush', () => {
    it('writes gzipped NDJSON to S3 with correct key pattern', async () => {
      enableS3();
      // Fix the clock so we can predict the key
      vi.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));

      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('BDFM', [makeTrain({ routeId: 'B' })]);
      await stopArchiver();

      expect(putCalls).toHaveLength(1);
      const { Bucket, Key, ContentEncoding, ContentType } = putCalls[0];

      expect(Bucket).toBe('test-analytics-bucket');
      expect(Key).toMatch(
        /^raw\/positions\/year=2026\/month=02\/day=23\/hour=14\/\d+-[0-9a-f-]+\.ndjson\.gz$/,
      );
      expect(ContentEncoding).toBe('gzip');
      expect(ContentType).toBe('application/x-ndjson');
    });

    it('clears buffer after write — second flush produces nothing', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('G', [makeTrain({ routeId: 'G' })]);

      // First flush via stopArchiver
      await stopArchiver();
      expect(putCalls).toHaveLength(1);

      // Second stopArchiver should not produce more puts
      putCalls.length = 0;
      await stopArchiver();
      expect(putCalls).toHaveLength(0);
    });

    it('handles multiple feed groups in one cycle', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('ACE', [makeTrain({ routeId: 'A' })]);
      archivePositions('BDFM', [makeTrain({ routeId: 'B' })]);
      archivePositions('G', [makeTrain({ routeId: 'G' })]);

      await stopArchiver();

      // One PutObjectCommand per feed group
      expect(putCalls).toHaveLength(3);

      const keys = putCalls.map((c) => c.Key);
      // Each key is unique
      expect(new Set(keys).size).toBe(3);
    });

    it('accumulates records within the same feed group across calls', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('ACE', [makeTrain({ tripId: 'trip-1' })]);
      archivePositions('ACE', [makeTrain({ tripId: 'trip-2' }), makeTrain({ tripId: 'trip-3' })]);

      await stopArchiver();

      expect(putCalls).toHaveLength(1);
      const records = await decompressNdjson(putCalls[0].Body);
      expect(records).toHaveLength(3);
      expect(records.map((r) => r.tripId)).toEqual(['trip-1', 'trip-2', 'trip-3']);
    });
  });

  // -------------------------------------------------------------------------
  // Record shape
  // -------------------------------------------------------------------------

  describe('record shape', () => {
    it('each record includes a numeric capturedAt timestamp', async () => {
      enableS3();
      vi.setSystemTime(new Date('2026-02-23T10:00:00.000Z'));

      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('L', [makeTrain({ routeId: 'L' })]);
      await stopArchiver();

      const records = await decompressNdjson(putCalls[0].Body);
      expect(records).toHaveLength(1);
      expect(typeof records[0].capturedAt).toBe('number');
      // Should be the time of archivePositions call, not the flush time
      expect(records[0].capturedAt).toBe(new Date('2026-02-23T10:00:00.000Z').getTime());
    });

    it('each record includes the feedGroupId', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('NQRW', [makeTrain({ routeId: 'N' })]);
      await stopArchiver();

      const records = await decompressNdjson(putCalls[0].Body);
      expect(records[0].feedGroupId).toBe('NQRW');
    });

    it('capturedAt is the time of archivePositions, not the flush time', async () => {
      enableS3();
      vi.setSystemTime(new Date('2026-02-23T08:00:00.000Z'));

      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('JZ', [makeTrain({ routeId: 'J' })]);

      // Advance time significantly before flush
      vi.setSystemTime(new Date('2026-02-23T09:00:00.000Z'));

      await stopArchiver();

      const records = await decompressNdjson(putCalls[0].Body);
      // capturedAt should be 08:00, not 09:00
      expect(records[0].capturedAt).toBe(new Date('2026-02-23T08:00:00.000Z').getTime());
    });

    it('preserves all original TrainPosition fields', async () => {
      enableS3();
      const train = makeTrain({
        tripId: 'test-trip',
        routeId: 'A',
        lat: 40.123,
        lon: -73.456,
        heading: 90,
        nextStopId: 'A01N',
        nextStopName: 'Inwood',
        eta: '5m',
        headsign: 'Far Rockaway',
        prevStopId: 'A02N',
        prevTimeMs: 1000,
        nextTimeMs: 2000,
      });

      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('ACE', [train]);
      await stopArchiver();

      const records = await decompressNdjson(putCalls[0].Body);
      const record = records[0];
      expect(record.tripId).toBe('test-trip');
      expect(record.routeId).toBe('A');
      expect(record.lat).toBe(40.123);
      expect(record.lon).toBe(-73.456);
      expect(record.heading).toBe(90);
      expect(record.nextStopId).toBe('A01N');
      expect(record.nextStopName).toBe('Inwood');
      expect(record.eta).toBe('5m');
      expect(record.headsign).toBe('Far Rockaway');
      expect(record.prevStopId).toBe('A02N');
      expect(record.prevTimeMs).toBe(1000);
      expect(record.nextTimeMs).toBe(2000);
    });
  });

  // -------------------------------------------------------------------------
  // stopArchiver lifecycle
  // -------------------------------------------------------------------------

  describe('stopArchiver', () => {
    it('flushes remaining buffered data', async () => {
      enableS3();
      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      archivePositions('SI', [makeTrain({ routeId: 'SIR' })]);
      archivePositions('1234567', [makeTrain({ routeId: '1' })]);

      await stopArchiver();

      expect(putCalls).toHaveLength(2);
      // Verify both feed groups were flushed
      const allRecords = await Promise.all(putCalls.map((c) => decompressNdjson(c.Body)));
      const allFeedGroups = allRecords.map((r) => r[0].feedGroupId);
      expect(allFeedGroups).toContain('SI');
      expect(allFeedGroups).toContain('1234567');
    });

    it('is safe to call multiple times', async () => {
      enableS3();
      const { stopArchiver } = await import('../analytics/position-archiver.js');

      // Should not throw even without any prior archivePositions calls
      await stopArchiver();
      await stopArchiver();
      expect(putCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // S3 error handling
  // -------------------------------------------------------------------------

  describe('S3 error handling', () => {
    it('continues operation after S3 upload failure', async () => {
      putCalls.length = 0;
      const failOnce = vi.fn()
        .mockRejectedValueOnce(new Error('S3 network timeout'))
        .mockImplementation(async (cmd: { input: unknown }) => {
          putCalls.push((cmd as { input: typeof putCalls[0] }).input);
        });

      mockS3Client = { send: failOnce };
      mockBucket = 'test-analytics-bucket';

      const { archivePositions, stopArchiver } = await import(
        '../analytics/position-archiver.js'
      );

      // This batch will fail during flush
      archivePositions('ACE', [makeTrain({ routeId: 'A' })]);
      await stopArchiver();

      // The send was called (and threw), but no crash
      expect(failOnce).toHaveBeenCalledTimes(1);
    });
  });
});
