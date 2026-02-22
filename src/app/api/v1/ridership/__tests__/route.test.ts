import { describe, it, expect } from 'vitest';
import { GET } from '../route';
import { NextRequest } from 'next/server';

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/v1/ridership', () => {
  it('returns ridership data with default 30 days', async () => {
    const res = await GET(createRequest('/api/v1/ridership'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.days).toHaveLength(30);
    expect(body.latest).toBeDefined();
    expect(body.latest.ridership).toBeGreaterThan(0);
    expect(body.latest.prePandemicPercent).toBeGreaterThan(0);
    expect(body.avgDaily).toBeGreaterThan(0);
    expect(body.totalRidership).toBeGreaterThan(0);
    expect(body.dailyFareRevenue).toBe(Math.round(body.latest.ridership * 3.00));
    expect(body.updatedAt).toBeDefined();
  });

  it('respects days parameter', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.days).toHaveLength(7);
  });

  it('returns 400 for invalid days', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for days=0', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative days', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=-5'));
    expect(res.status).toBe(400);
  });

  it('clamps days to 365', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=500'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.days).toHaveLength(365);
  });

  it('each day has required fields', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=3'));
    const body = await res.json();

    for (const day of body.days) {
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('ridership');
      expect(day).toHaveProperty('prePandemicPercent');
      expect(typeof day.ridership).toBe('number');
      expect(typeof day.prePandemicPercent).toBe('number');
    }
  });

  it('latest is the first (most recent) entry', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=7'));
    const body = await res.json();

    expect(body.latest.date).toBe(body.days[0].date);
    expect(body.latest.ridership).toBe(body.days[0].ridership);
  });

  it('computes totalRidership as sum of all days', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=5'));
    const body = await res.json();

    const expectedTotal = body.days.reduce(
      (sum: number, d: { ridership: number }) => sum + d.ridership,
      0,
    );
    expect(body.totalRidership).toBe(expectedTotal);
  });

  it('computes avgDaily as totalRidership / number of days', async () => {
    const res = await GET(createRequest('/api/v1/ridership?days=5'));
    const body = await res.json();

    expect(body.avgDaily).toBe(Math.round(body.totalRidership / body.days.length));
  });

  it('returns correct number of days for various values', async () => {
    for (const n of [1, 10, 60]) {
      const res = await GET(createRequest(`/api/v1/ridership?days=${n}`));
      const body = await res.json();
      expect(body.days).toHaveLength(n);
    }
  });
});
