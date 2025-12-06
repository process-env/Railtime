import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

/**
 * Tests for the disabled historical analytics route
 *
 * NOTE: This route was disabled for performance reasons (took 49+ seconds).
 * It now returns empty data immediately with a disabled flag.
 */
describe('GET /api/v1/analytics/historical', () => {
  it('returns empty data with disabled flag', async () => {
    const request = new NextRequest('http://localhost/api/v1/analytics/historical');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.disabled).toBe(true);
    expect(data.trainHistory).toEqual([]);
    expect(data.routeBreakdown).toEqual([]);
    expect(data.delayDistribution).toEqual([]);
    expect(data.timestamp).toBeDefined();
  });

  it('returns empty data regardless of hours parameter', async () => {
    const request = new NextRequest('http://localhost/api/v1/analytics/historical?hours=24');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.disabled).toBe(true);
  });

  it('includes collection stats showing zero data', async () => {
    const request = new NextRequest('http://localhost/api/v1/analytics/historical');
    const response = await GET(request);
    const data = await response.json();

    expect(data.collectionStats).toEqual({
      totalSnapshots: 0,
      totalArrivals: 0,
      totalAlerts: 0,
    });
  });
});
