import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { createMockTrainPosition } from '@/test/factories';
import type { TrainPosition } from '@/types/mta';

// CacheEnvelope shape (matches route.ts)
interface CacheEnvelope {
  data: TrainPosition[];
  cachedAt: string;
}

function envelope(data: TrainPosition[], cachedAt?: string): CacheEnvelope {
  return { data, cachedAt: cachedAt ?? new Date().toISOString() };
}

// Mock Redis cache functions (including new pipeline + lock utilities)
vi.mock('@/lib/redis', () => ({
  getCache: vi.fn(),
  setCache: vi.fn().mockResolvedValue(undefined),
  deleteCache: vi.fn().mockResolvedValue(undefined),
  pipelineGet: vi.fn(),
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

// Mock MTA feed fetching
vi.mock('@/lib/mta/fetch-feed', () => ({
  fetchFeed: vi.fn(),
}));

// Mock train position calculation
vi.mock('@/lib/mta/train-positions', () => ({
  calculateTrainPositions: vi.fn(),
}));

// Mock feed group lookup (used by writeBackToCache)
vi.mock('@/lib/mta/feed-groups', () => ({
  routeToFeedGroup: vi.fn((routeId: string) => {
    const map: Record<string, string> = {
      A: 'ACE', C: 'ACE', E: 'ACE',
      B: 'BDFM', D: 'BDFM', F: 'BDFM', M: 'BDFM',
      G: 'G',
      J: 'JZ', Z: 'JZ',
      N: 'NQRW', Q: 'NQRW', R: 'NQRW', W: 'NQRW',
      L: 'L',
      SI: 'SI',
      '1': '1234567', '2': '1234567', '3': '1234567',
      '4': '1234567', '5': '1234567', '6': '1234567', '7': '1234567',
    };
    return map[routeId] || null;
  }),
}));

// Mock rate limiting -- allow by default
vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ success: true, remaining: 119, resetIn: 60000 }),
  getClientId: vi.fn().mockReturnValue('test-client'),
  createRateLimitKey: vi.fn().mockReturnValue('test-client:/api/v1/trains'),
  RATE_LIMITS: { realtime: { limit: 120, windowMs: 60000 } },
}));

import { getCache, setCache, pipelineGet, acquireLock } from '@/lib/redis';
import { fetchFeed } from '@/lib/mta/fetch-feed';
import { calculateTrainPositions } from '@/lib/mta/train-positions';
import { checkRateLimit } from '@/lib/api/rate-limit';

const FEED_GROUP_IDS = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];

describe('GET /api/v1/trains', () => {
  const mockPositions: TrainPosition[] = [
    createMockTrainPosition({ tripId: 'trip-1', routeId: 'A' }),
    createMockTrainPosition({ tripId: 'trip-2', routeId: '1' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: cache miss
    vi.mocked(getCache).mockResolvedValue(null);
    vi.mocked(setCache).mockResolvedValue(undefined);
    vi.mocked(fetchFeed).mockResolvedValue([]);
    vi.mocked(calculateTrainPositions).mockResolvedValue(mockPositions);
    vi.mocked(checkRateLimit).mockReturnValue({ success: true, remaining: 119, resetIn: 60000 });
    vi.mocked(acquireLock).mockResolvedValue(true);
    // Default: pipeline returns all nulls (cache miss)
    vi.mocked(pipelineGet).mockResolvedValue(new Array(FEED_GROUP_IDS.length).fill(null));
  });

  // --- Full cache hit (all groups via pipeline) ---

  it('returns cached trains when all feed groups are in Redis', async () => {
    vi.mocked(pipelineGet).mockResolvedValue(
      FEED_GROUP_IDS.map(() => envelope(mockPositions))
    );

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('cache');
    expect(pipelineGet).toHaveBeenCalledTimes(1);
    expect(data.updatedAt).toBeDefined();
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  // --- Single-group cache hit ---

  it('returns cached trains for a single group when groupId is provided', async () => {
    vi.mocked(getCache).mockResolvedValue(envelope(mockPositions));

    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('cache');
    expect(getCache).toHaveBeenCalledWith('feed:ACE:positions');
  });

  // --- Full cache miss (all groups) ---

  it('fetches from MTA when cache misses and returns source=mta', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('mta');
    expect(fetchFeed).toHaveBeenCalledTimes(FEED_GROUP_IDS.length);
    for (const gid of FEED_GROUP_IDS) {
      expect(fetchFeed).toHaveBeenCalledWith(gid);
    }
    expect(calculateTrainPositions).toHaveBeenCalled();
  });

  // --- Single-group cache miss ---

  it('fetches single feed group from MTA when groupId provided and cache misses', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('mta');
    expect(fetchFeed).toHaveBeenCalledWith('ACE');
    expect(fetchFeed).toHaveBeenCalledTimes(1);
  });

  // --- Partial cache (some groups hit, some miss) ---

  it('returns partial-cache source when some groups are cached', async () => {
    vi.mocked(pipelineGet).mockResolvedValue([
      envelope(mockPositions), // ACE hit
      null, null, null, null, null, null, null, // rest miss
    ]);

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('partial-cache');
    expect(fetchFeed).toHaveBeenCalledTimes(FEED_GROUP_IDS.length - 1);
    expect(fetchFeed).not.toHaveBeenCalledWith('ACE');
  });

  it('merges cached and fresh positions in partial cache scenario', async () => {
    const cachedPositions = [createMockTrainPosition({ tripId: 'cached-1', routeId: 'A' })];
    const freshPositions = [createMockTrainPosition({ tripId: 'fresh-1', routeId: '1' })];

    vi.mocked(pipelineGet).mockResolvedValue([
      envelope(cachedPositions), // ACE
      null, null, null, null, null, null, null,
    ]);

    vi.mocked(calculateTrainPositions).mockResolvedValue(freshPositions);

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(data.trains).toHaveLength(2);
    expect(data.trains.some((t: TrainPosition) => t.tripId === 'cached-1')).toBe(true);
    expect(data.trains.some((t: TrainPosition) => t.tripId === 'fresh-1')).toBe(true);
  });

  // --- Cache write-back ---

  it('writes positions back to Redis after MTA fetch', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains');
    await GET(request);

    expect(setCache).toHaveBeenCalled();
  });

  it('writes single group to cache with CacheEnvelope when groupId is provided', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    await GET(request);

    expect(setCache).toHaveBeenCalledWith(
      'feed:ACE:positions',
      expect.objectContaining({ data: mockPositions, cachedAt: expect.any(String) }),
      expect.any(Number)
    );
  });

  // --- Validation ---

  it('returns 400 for invalid groupId', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains?groupId=INVALID');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
    expect(data.error.message).toContain('Invalid feed group');
  });

  it('accepts all valid feed group IDs', async () => {
    for (const groupId of FEED_GROUP_IDS) {
      vi.clearAllMocks();
      vi.mocked(getCache).mockResolvedValue(null);
      vi.mocked(fetchFeed).mockResolvedValue([]);
      vi.mocked(calculateTrainPositions).mockResolvedValue([]);
      vi.mocked(checkRateLimit).mockReturnValue({ success: true, remaining: 119, resetIn: 60000 });
      vi.mocked(acquireLock).mockResolvedValue(true);

      const request = new NextRequest(`http://localhost/api/v1/trains?groupId=${groupId}`);
      const response = await GET(request);

      expect(response.status).toBe(200);
    }
  });

  // --- Rate limiting ---

  it('returns 429 when rate limited', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ success: false, remaining: 0, resetIn: 30000 });

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe('RATE_LIMITED');
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  // --- Error handling ---

  it('handles individual feed group fetch failures gracefully', async () => {
    vi.mocked(fetchFeed).mockRejectedValue(new Error('MTA API down'));

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(calculateTrainPositions).toHaveBeenCalledWith([]);
  });

  it('returns 500 when calculateTrainPositions throws', async () => {
    vi.mocked(calculateTrainPositions).mockRejectedValue(new Error('Parse error'));

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns stale data when single-group fetchFeed throws but stale cache exists', async () => {
    const stalePositions = [createMockTrainPosition({ tripId: 'stale-1', routeId: 'A' })];
    // Call sequence when acquireLock returns true:
    // 1. getCache('feed:ACE:positions') → null (primary cache miss)
    // 2. fetchFeed throws → catch block
    // 3. getCache('feed:ACE:positions:stale') → envelope (stale hit)
    vi.mocked(getCache)
      .mockResolvedValueOnce(null)                       // primary cache miss
      .mockResolvedValueOnce(envelope(stalePositions));  // stale cache hit
    vi.mocked(fetchFeed).mockRejectedValue(new Error('MTA API down'));

    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('stale');
    expect(data.trains).toEqual(stalePositions);
  });

  it('returns 500 when single-group fetchFeed throws and no stale cache', async () => {
    // getCache returns null for both primary and stale
    vi.mocked(getCache)
      .mockResolvedValueOnce(null)  // primary cache miss
      .mockResolvedValueOnce(null); // stale cache miss
    vi.mocked(fetchFeed).mockRejectedValue(new Error('MTA API down'));

    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe('INTERNAL_ERROR');
    expect(data.error.message).toBe('Failed to fetch trains');
  });

  it('returns 500 when Redis pipelineGet throws', async () => {
    vi.mocked(pipelineGet).mockRejectedValue(new Error('Redis connection lost'));

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe('INTERNAL_ERROR');
  });

  // --- Response shape ---

  it('includes updatedAt ISO timestamp in response', async () => {
    const before = new Date().toISOString();
    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();
    const after = new Date().toISOString();

    expect(data.updatedAt).toBeDefined();
    expect(data.updatedAt >= before).toBe(true);
    expect(data.updatedAt <= after).toBe(true);
  });

  it('sets cache-control headers', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe('s-maxage=10, stale-while-revalidate=5');
  });

  // --- Stale fallback cache ---

  it('writes stale fallback cache with CacheEnvelope for single group', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    await GET(request);

    expect(setCache).toHaveBeenCalledWith(
      'feed:ACE:positions:stale',
      expect.objectContaining({ data: mockPositions, cachedAt: expect.any(String) }),
      120
    );
  });

  it('uses stale fallback for failed groups in all-groups path', async () => {
    const cachedPositions = [createMockTrainPosition({ tripId: 'cached-1', routeId: 'A' })];
    const stalePositions = [createMockTrainPosition({ tripId: 'stale-1', routeId: 'G' })];

    // Pipeline returns ACE cached, rest miss
    vi.mocked(pipelineGet)
      .mockResolvedValueOnce([
        envelope(cachedPositions), // ACE
        null, null, null, null, null, null, null,
      ])
      .mockResolvedValueOnce([ // stale fallback pipeline for failed group (G)
        envelope(stalePositions),
      ]);

    vi.mocked(fetchFeed).mockImplementation(async (gid: string) => {
      if (gid === 'G') throw new Error('MTA API down');
      return [];
    });

    const freshPositions = [createMockTrainPosition({ tripId: 'fresh-1', routeId: '1' })];
    vi.mocked(calculateTrainPositions).mockResolvedValue(freshPositions);

    const request = new NextRequest('http://localhost/api/v1/trains');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('partial-stale');
    expect(data.trains).toHaveLength(3);
    expect(data.trains.some((t: TrainPosition) => t.tripId === 'cached-1')).toBe(true);
    expect(data.trains.some((t: TrainPosition) => t.tripId === 'fresh-1')).toBe(true);
    expect(data.trains.some((t: TrainPosition) => t.tripId === 'stale-1')).toBe(true);
  });

  // --- Cache stampede protection ---

  it('acquires lock before fetching from MTA', async () => {
    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    await GET(request);

    expect(acquireLock).toHaveBeenCalledWith(
      'lock:feed:ACE:fetch',
      expect.any(Number)
    );
  });

  it('returns cached updatedAt from CacheEnvelope on cache hit', async () => {
    const cachedAt = '2026-02-25T12:00:00.000Z';
    vi.mocked(getCache).mockResolvedValue(envelope(mockPositions, cachedAt));

    const request = new NextRequest('http://localhost/api/v1/trains?groupId=ACE');
    const response = await GET(request);
    const data = await response.json();

    expect(data.updatedAt).toBe(cachedAt);
    expect(data.source).toBe('cache');
  });
});
