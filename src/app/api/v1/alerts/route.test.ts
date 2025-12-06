import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { createMockServiceAlert } from '@/test/factories';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  fetchAlerts: vi.fn(),
  filterAlertsByRoutes: vi.fn((alerts, routeIds) =>
    alerts.filter((a: any) => a.affectedRoutes.some((r: string) => routeIds.includes(r)))
  ),
}));

import { fetchAlerts, filterAlertsByRoutes } from '@/lib/mta';

describe('GET /api/v1/alerts', () => {
  const mockAlerts = [
    createMockServiceAlert({ affectedRoutes: ['A', 'C', 'E'] }),
    createMockServiceAlert({ affectedRoutes: ['1', '2', '3'] }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (fetchAlerts as any).mockResolvedValue(mockAlerts);
  });

  it('returns all alerts when no filter', async () => {
    const request = new NextRequest('http://localhost/api/v1/alerts');
    const response = await GET(request);
    const data = await response.json();

    expect(data.alerts).toHaveLength(2);
    expect(data.count).toBe(2);
    expect(data.updatedAt).toBeDefined();
  });

  it('filters alerts by route', async () => {
    const request = new NextRequest('http://localhost/api/v1/alerts?route=A,C');
    const response = await GET(request);
    const data = await response.json();

    expect(filterAlertsByRoutes).toHaveBeenCalledWith(mockAlerts, ['A', 'C']);
  });

  it('handles any route filter (no validation at route level)', async () => {
    // Route filter is passed directly to filterAlertsByRoutes, no validation
    const request = new NextRequest('http://localhost/api/v1/alerts?route=ANYTHING');
    const response = await GET(request);

    expect(response.status).toBe(200);
    // The filter just won't match any routes
    expect(filterAlertsByRoutes).toHaveBeenCalledWith(mockAlerts, ['ANYTHING']);
  });

  it('bypasses cache when nocache=true', async () => {
    const request = new NextRequest('http://localhost/api/v1/alerts?nocache=true');
    await GET(request);

    expect(fetchAlerts).toHaveBeenCalledWith({ useCache: false });
  });

  it('uses cache by default', async () => {
    const request = new NextRequest('http://localhost/api/v1/alerts');
    await GET(request);

    expect(fetchAlerts).toHaveBeenCalledWith({ useCache: true });
  });

  it('returns 500 on fetch error', async () => {
    (fetchAlerts as any).mockRejectedValue(new Error('API Error'));

    const request = new NextRequest('http://localhost/api/v1/alerts');
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('API Error');
  });

  it('handles non-Error thrown values', async () => {
    (fetchAlerts as any).mockRejectedValue('string error');

    const request = new NextRequest('http://localhost/api/v1/alerts');
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to fetch alerts');
  });

  it('filters with multiple routes', async () => {
    const request = new NextRequest('http://localhost/api/v1/alerts?route=A,C,E,1,2,3');
    await GET(request);

    expect(filterAlertsByRoutes).toHaveBeenCalledWith(mockAlerts, ['A', 'C', 'E', '1', '2', '3']);
  });
});
