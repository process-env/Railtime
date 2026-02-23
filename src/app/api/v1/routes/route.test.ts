import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createAllSubwayRoutes } from '@/test/factories';
import type { Route } from '@/types/mta';
import { NextRequest } from 'next/server';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  loadRoutes: vi.fn(),
}));

// Mock rate limiting to always allow
vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ success: true, remaining: 59, resetIn: 60000 }),
  getClientId: vi.fn().mockReturnValue('test-client'),
  createRateLimitKey: vi.fn().mockReturnValue('test-client:/api/v1/routes'),
  RATE_LIMITS: { static: { limit: 60, windowMs: 60000 } },
}));

import { loadRoutes } from '@/lib/mta';

function createMockRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/routes');
}

describe('GET /api/v1/routes', () => {
  const mockRoutes = createAllSubwayRoutes();
  const mockDict = Object.fromEntries(mockRoutes.map((r: Route) => [r.route_id, r]));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadRoutes).mockResolvedValue({ list: mockRoutes, dict: mockDict });
  });

  it('returns all routes', async () => {
    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(data).toHaveLength(23);
    expect(data[0]).toHaveProperty('route_id');
    expect(data[0]).toHaveProperty('color');
  });

  it('returns routes with correct structure', async () => {
    const response = await GET(createMockRequest());
    const data = await response.json();

    const routeA = data.find((r: { route_id: string }) => r.route_id === 'A');
    expect(routeA).toBeDefined();
    expect(routeA.short_name).toBe('A');
    expect(routeA.color).toBe('0039A6');
  });

  it('returns 500 on load error with sanitized message', async () => {
    vi.mocked(loadRoutes).mockRejectedValue(new Error('File not found'));

    const response = await GET(createMockRequest());

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to load routes');
    expect(data.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles empty routes list', async () => {
    vi.mocked(loadRoutes).mockResolvedValue({ list: [], dict: {} });

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(data).toHaveLength(0);
  });

  it('includes all major subway routes', async () => {
    const response = await GET(createMockRequest());
    const data = await response.json();

    const routeIds = data.map((r: { route_id: string }) => r.route_id);
    expect(routeIds).toContain('A');
    expect(routeIds).toContain('1');
    expect(routeIds).toContain('7');
    expect(routeIds).toContain('L');
  });
});
