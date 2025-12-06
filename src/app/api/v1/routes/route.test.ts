import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createMockRoute, createAllSubwayRoutes } from '@/test/factories';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  loadRoutes: vi.fn(),
}));

import { loadRoutes } from '@/lib/mta';

describe('GET /api/v1/routes', () => {
  const mockRoutes = createAllSubwayRoutes();

  beforeEach(() => {
    vi.clearAllMocks();
    (loadRoutes as any).mockResolvedValue({ list: mockRoutes });
  });

  it('returns all routes', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data).toHaveLength(23);
    expect(data[0]).toHaveProperty('route_id');
    expect(data[0]).toHaveProperty('color');
  });

  it('returns routes with correct structure', async () => {
    const response = await GET();
    const data = await response.json();

    const routeA = data.find((r: any) => r.route_id === 'A');
    expect(routeA).toBeDefined();
    expect(routeA.short_name).toBe('A');
    expect(routeA.color).toBe('0039A6');
  });

  it('returns 500 on load error', async () => {
    (loadRoutes as any).mockRejectedValue(new Error('File not found'));

    const response = await GET();

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('File not found');
    expect(data.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles empty routes list', async () => {
    (loadRoutes as any).mockResolvedValue({ list: [] });

    const response = await GET();
    const data = await response.json();

    expect(data).toHaveLength(0);
  });

  it('includes all major subway routes', async () => {
    const response = await GET();
    const data = await response.json();

    const routeIds = data.map((r: any) => r.route_id);
    expect(routeIds).toContain('A');
    expect(routeIds).toContain('1');
    expect(routeIds).toContain('7');
    expect(routeIds).toContain('L');
  });
});
