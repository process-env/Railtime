import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

function createRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

const mockSocrataData = [
  { day: '2026-02-21T00:00:00.000', total_ridership: '3500000.0' },
  { day: '2026-02-20T00:00:00.000', total_ridership: '3400000.0' },
];

function mockFetchSuccess(data: unknown[] = mockSocrataData) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchFailure(status = 500, statusText = 'Internal Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
  });
}

describe('GET /api/v1/ridership', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function getHandler() {
    const mod = await import('../route');
    return mod.GET;
  }

  describe('happy path', () => {
    it('returns 200 with parsed ridership data', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('days');
      expect(body).toHaveProperty('latest');
      expect(body).toHaveProperty('avgDaily');
      expect(body).toHaveProperty('totalRidership');
      expect(body).toHaveProperty('dailyFareRevenue');
      expect(body).toHaveProperty('updatedAt');
    });

    it('parses ridership from string to number', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();
      expect(body.latest.ridership).toBe(3_500_000);
      expect(typeof body.latest.ridership).toBe('number');
    });

    it('calculates prePandemicPercent from ridership / 5.5M baseline', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();
      // 3500000 / 5500000 * 100 = 63.636... -> rounded to 63.6
      expect(body.latest.prePandemicPercent).toBe(63.6);
      expect(typeof body.latest.prePandemicPercent).toBe('number');
    });

    it('orders latest as the first (most recent) entry', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();
      expect(body.latest.date).toBe('2026-02-21T00:00:00.000');
    });

    it('computes totalRidership as sum of all days', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();
      expect(body.totalRidership).toBe(3_500_000 + 3_400_000);
    });

    it('computes avgDaily as totalRidership / number of days', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();
      expect(body.avgDaily).toBe(Math.round((3_500_000 + 3_400_000) / 2));
    });

    it('computes dailyFareRevenue from latest ridership x $2.90', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();
      expect(body.dailyFareRevenue).toBe(Math.round(3_500_000 * 2.90));
    });
  });

  describe('default days parameter', () => {
    it('defaults to 30 days when no days param is provided', async () => {
      const fetchMock = mockFetchSuccess();
      global.fetch = fetchMock;
      const GET = await getHandler();
      await GET(createRequest('/api/v1/ridership'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl: string = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('%24limit=30');
    });
  });

  describe('invalid days parameter', () => {
    it('returns 400 for non-numeric days', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=abc'));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 for days=0', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=0'));
      expect(res.status).toBe(400);
    });

    it('returns 400 for negative days', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=-5'));
      expect(res.status).toBe(400);
    });
  });

  describe('days clamping', () => {
    it('clamps days to 365 when a larger value is given', async () => {
      const fetchMock = mockFetchSuccess();
      global.fetch = fetchMock;
      const GET = await getHandler();
      await GET(createRequest('/api/v1/ridership?days=9999'));
      const calledUrl: string = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('%24limit=365');
    });
  });

  describe('Socrata error handling', () => {
    it('returns 502 when Socrata returns a non-OK status', async () => {
      global.fetch = mockFetchFailure(500, 'Internal Server Error');
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.message).toContain('500');
    });

    it('returns 502 when fetch throws a network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.message).toContain('Network failure');
    });
  });

  describe('cache behavior', () => {
    it('returns X-Cache MISS on the first call', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res.headers.get('X-Cache')).toBe('MISS');
    });

    it('returns X-Cache HIT on subsequent calls with same days', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();
      await GET(createRequest('/api/v1/ridership?days=30'));
      const res2 = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res2.headers.get('X-Cache')).toBe('HIT');
    });

    it('returns stale cache when Socrata fails after a previous success', async () => {
      const fetchMock = mockFetchSuccess();
      global.fetch = fetchMock;
      const GET = await getHandler();
      await GET(createRequest('/api/v1/ridership?days=30'));
      global.fetch = vi.fn().mockRejectedValue(new Error('down'));
      const res = await GET(createRequest('/api/v1/ridership?days=7'));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Cache')).toBe('STALE');
    });
  });

  describe('empty data', () => {
    it('handles empty Socrata response gracefully', async () => {
      global.fetch = mockFetchSuccess([]);
      const GET = await getHandler();
      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.days).toHaveLength(0);
      expect(body.latest).toBeNull();
      expect(body.avgDaily).toBe(0);
      expect(body.totalRidership).toBe(0);
      expect(body.dailyFareRevenue).toBe(0);
    });
  });
});
