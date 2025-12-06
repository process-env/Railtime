import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import { createMockNextRequest } from '@/test/helpers';

// Mock the data-collector module
vi.mock('@/lib/data-collector', () => ({
  cleanupOldData: vi.fn().mockResolvedValue({
    trainSnapshots: 100,
    arrivalEvents: 50,
    feedLogs: 25,
  }),
}));

describe('GET /api/cron/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('DATA_RETENTION_DAYS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns success with cleanup stats', async () => {
    const request = createMockNextRequest('/api/cron/cleanup');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.deleted).toEqual({
      trainSnapshots: 100,
      arrivalEvents: 50,
      feedLogs: 25,
    });
    expect(data.daysKept).toBe(30);
    expect(data.durationMs).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  it('respects DATA_RETENTION_DAYS env variable', async () => {
    vi.stubEnv('DATA_RETENTION_DAYS', '7');

    const request = createMockNextRequest('/api/cron/cleanup');
    const response = await GET(request);
    const data = await response.json();

    expect(data.daysKept).toBe(7);
  });

  it('returns 401 when CRON_SECRET is set but auth header is missing (in production)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'test-secret');

    const request = createMockNextRequest('/api/cron/cleanup');
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.message).toBe('Unauthorized');
  });

  it('returns 401 when CRON_SECRET does not match (in production)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'test-secret');

    const request = createMockNextRequest('/api/cron/cleanup', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it('allows request when CRON_SECRET matches (in production)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'test-secret');

    const request = createMockNextRequest('/api/cron/cleanup', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('allows request in development without CRON_SECRET', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    // Note: CRON_SECRET is NOT set - test passes only when no secret configured

    const request = createMockNextRequest('/api/cron/cleanup');
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('requires auth in development when CRON_SECRET is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CRON_SECRET', 'test-secret');

    // No auth header provided
    const request = createMockNextRequest('/api/cron/cleanup');
    const response = await GET(request);

    // Should require auth even in development if CRON_SECRET is configured
    expect(response.status).toBe(401);
  });
});
