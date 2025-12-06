import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';
import { NextRequest } from 'next/server';

// Mock the data collector
vi.mock('@/lib/data-collector', () => ({
  runCollection: vi.fn(),
  cleanupOldData: vi.fn(),
}));

// Mock the db
vi.mock('@/lib/db', () => ({
  db: {
    trainSnapshot: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    arrivalEvent: { count: vi.fn() },
    alertLog: { count: vi.fn() },
    feedPollLog: { findMany: vi.fn() },
  },
}));

import { runCollection, cleanupOldData } from '@/lib/data-collector';
import { db } from '@/lib/db';

describe('POST /api/v1/collect', () => {
  const mockCollectionResult = {
    trainSnapshots: 50,
    arrivalEvents: 100,
    alertsUpdated: 5,
    feedLogs: 8,
    duration: 1500,
    errors: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (runCollection as any).mockResolvedValue(mockCollectionResult);
    (cleanupOldData as any).mockResolvedValue({
      trainSnapshots: 10,
      arrivalEvents: 20,
      feedLogs: 5,
    });
  });

  it('runs collection and returns results', async () => {
    const request = new NextRequest('http://localhost/api/v1/collect', {
      method: 'POST',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.collection.trainSnapshots).toBe(50);
    expect(data.collection.arrivalEvents).toBe(100);
    expect(data.collection.durationMs).toBe(1500);
    expect(data.cleanup).toBeUndefined();
  });

  it('runs cleanup when cleanup=true', async () => {
    const request = new NextRequest('http://localhost/api/v1/collect?cleanup=true', {
      method: 'POST',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(cleanupOldData).toHaveBeenCalledWith(30); // default days
    expect(data.cleanup).toBeDefined();
    expect(data.cleanup.trainSnapshotsDeleted).toBe(10);
    expect(data.cleanup.daysKept).toBe(30);
  });

  it('respects custom days parameter for cleanup', async () => {
    const request = new NextRequest('http://localhost/api/v1/collect?cleanup=true&days=7', {
      method: 'POST',
    });
    await POST(request);

    expect(cleanupOldData).toHaveBeenCalledWith(7);
  });

  it('returns 400 for invalid days parameter', async () => {
    const request = new NextRequest('http://localhost/api/v1/collect?cleanup=true&days=1000', {
      method: 'POST',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('includes errors in response when collection has errors', async () => {
    (runCollection as any).mockResolvedValue({
      ...mockCollectionResult,
      errors: ['Feed ACE failed', 'Feed G timeout'],
    });

    const request = new NextRequest('http://localhost/api/v1/collect', {
      method: 'POST',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.collection.errors).toHaveLength(2);
  });

  it('returns 500 on collection error', async () => {
    (runCollection as any).mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost/api/v1/collect', {
      method: 'POST',
    });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Database connection failed');
  });
});

describe('GET /api/v1/collect (stats)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    (db.trainSnapshot.count as any).mockResolvedValue(1000);
    (db.arrivalEvent.count as any).mockResolvedValue(5000);
    // Use mockImplementation to return different values on each call
    let alertCountCalls = 0;
    (db.alertLog.count as any).mockImplementation(() => {
      alertCountCalls++;
      return Promise.resolve(alertCountCalls === 1 ? 100 : 10);
    });
    (db.feedPollLog.findMany as any).mockResolvedValue([
      {
        feedGroupId: 'ACE',
        status: 'success',
        entityCount: 50,
        latencyMs: 200,
        createdAt: new Date(),
      },
    ]);
    // Use mockImplementation for multiple calls with different values
    let snapshotFindFirstCalls = 0;
    (db.trainSnapshot.findFirst as any).mockImplementation(() => {
      snapshotFindFirstCalls++;
      return Promise.resolve(
        snapshotFindFirstCalls === 1
          ? { createdAt: new Date('2024-01-01') }
          : { createdAt: new Date('2024-01-15') }
      );
    });
  });

  it('returns collection statistics', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.counts.trainSnapshots).toBe(1000);
    expect(data.counts.arrivalEvents).toBe(5000);
    expect(data.dataRange).toBeDefined();
    expect(data.recentPolls).toHaveLength(1);
  });

  it('handles empty data', async () => {
    (db.trainSnapshot.count as any).mockResolvedValue(0);
    (db.arrivalEvent.count as any).mockResolvedValue(0);
    (db.alertLog.count as any).mockResolvedValue(0);
    (db.feedPollLog.findMany as any).mockResolvedValue([]);
    (db.trainSnapshot.findFirst as any).mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(data.counts.trainSnapshots).toBe(0);
    expect(data.dataRange).toBeNull();
    expect(data.recentPolls).toHaveLength(0);
  });

  it('returns 500 on database error', async () => {
    (db.trainSnapshot.count as any).mockRejectedValue(new Error('DB Error'));

    const response = await GET();

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('DB Error');
    expect(data.error.code).toBe('INTERNAL_ERROR');
  });
});
