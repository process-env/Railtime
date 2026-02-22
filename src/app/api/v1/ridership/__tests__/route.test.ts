/**
 * Tests for the ridership API route handler.
 *
 * The route fetches MTA ridership data from the Socrata open data API,
 * parses string fields into numbers, and returns aggregated stats.
 * Global `fetch` is mocked to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

// Mock Socrata response rows (fields are strings, matching Socrata JSON)
const mockSocrataData = [
  {
    date: '2026-02-21T00:00:00.000',
    subways_total_estimated_ridership: '3500000',
    subways_of_comparable_pre_pandemic_day: '75.5',
  },
  {
    date: '2026-02-20T00:00:00.000',
    subways_total_estimated_ridership: '3400000',
    subways_of_comparable_pre_pandemic_day: '74.2',
  },
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GET /api/v1/ridership', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module so the in-memory cache is cleared between tests.
    vi.resetModules();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // Helper that dynamically imports the route handler after module reset.
  async function getHandler() {
    const mod = await import('../route');
    return mod.GET;
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
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

    it('parses prePandemicPercent from string to number', async () => {
      global.fetch = mockFetchSuccess();
      const GET = await getHandler();

      const res = await GET(createRequest('/api/v1/ridership?days=30'));
      const body = await res.json();

      expect(body.latest.prePandemicPercent).toBe(75.5);
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
  });

  // -------------------------------------------------------------------------
  // Default days parameter
  // -------------------------------------------------------------------------
  describe('default days parameter', () => {
    it('defaults to 30 days when no days param is provided', async () => {
      const fetchMock = mockFetchSuccess();
      global.fetch = fetchMock;
      const GET = await getHandler();

      await GET(createRequest('/api/v1/ridership'));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl: string = fetchMock.mock.calls[0][0];
      // The $limit should be "30"
      expect(calledUrl).toContain('%24limit=30');
    });
  });

  // -------------------------------------------------------------------------
  // Invalid days parameter
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Days clamping
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Socrata error handling
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Cache behavior
  // -------------------------------------------------------------------------
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

      // First call populates cache
      await GET(createRequest('/api/v1/ridership?days=30'));

      // Second call should hit cache
      const res2 = await GET(createRequest('/api/v1/ridership?days=30'));
      expect(res2.headers.get('X-Cache')).toBe('HIT');
    });

    it('returns stale cache when Socrata fails after a previous success', async () => {
      const fetchMock = mockFetchSuccess();
      global.fetch = fetchMock;
      const GET = await getHandler();

      // Populate cache
      await GET(createRequest('/api/v1/ridership?days=30'));

      // Now make fetch fail
      global.fetch = vi.fn().mockRejectedValue(new Error('down'));

      // Request with different days so cache key does not match,
      // but stale cache should still be returned as a fallback.
      const res = await GET(createRequest('/api/v1/ridership?days=7'));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Cache')).toBe('STALE');
    });
  });

  // -------------------------------------------------------------------------
  // Empty data
  // -------------------------------------------------------------------------
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
    });
  });
});
