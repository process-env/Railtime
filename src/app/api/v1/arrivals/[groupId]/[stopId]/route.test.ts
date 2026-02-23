import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { createMockArrivalBoard } from '@/test/factories';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  getArrivalBoard: vi.fn(),
}));

// Mock rate limiting to always allow
vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ success: true, remaining: 119, resetIn: 60000 }),
  getClientId: vi.fn().mockReturnValue('test-client'),
  createRateLimitKey: vi.fn().mockReturnValue('test-client:/api/v1/arrivals'),
  RATE_LIMITS: { realtime: { limit: 120, windowMs: 60000 } },
}));

import { getArrivalBoard } from '@/lib/mta';

describe('GET /api/v1/arrivals/[groupId]/[stopId]', () => {
  const mockBoard = createMockArrivalBoard();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getArrivalBoard).mockResolvedValue(mockBoard);
  });

  it('returns arrival board for valid params', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });
    const data = await response.json();

    expect(data.stopId).toBeDefined();
    expect(data.arrivals).toBeDefined();
    expect(getArrivalBoard).toHaveBeenCalledWith('ACE', 'A24N', { useCache: true });
  });

  it('handles invalid group ID gracefully', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/INVALID/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'INVALID', stopId: 'A24N' }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe('BAD_REQUEST');
    expect(data.error.message).toContain('Invalid groupId');
    expect(getArrivalBoard).not.toHaveBeenCalled();
  });

  it('handles invalid stop ID gracefully', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/INVALID!!');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'INVALID!!' }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe('BAD_REQUEST');
    expect(data.error.message).toContain('Invalid stopId');
    expect(getArrivalBoard).not.toHaveBeenCalled();
  });

  it('accepts stop IDs with N suffix', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/101N');
    await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: '101N' }),
    });

    expect(getArrivalBoard).toHaveBeenCalledWith('ACE', '101N', { useCache: true });
  });

  it('accepts stop IDs with S suffix', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/101S');
    await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: '101S' }),
    });

    expect(getArrivalBoard).toHaveBeenCalledWith('ACE', '101S', { useCache: true });
  });

  it('bypasses cache when nocache=true', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N?nocache=true');
    await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });

    expect(getArrivalBoard).toHaveBeenCalledWith('ACE', 'A24N', { useCache: false });
  });

  it('uses cache by default', async () => {
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N');
    await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });

    expect(getArrivalBoard).toHaveBeenCalledWith('ACE', 'A24N', { useCache: true });
  });

  it('returns 500 on fetch error with sanitized message', async () => {
    vi.mocked(getArrivalBoard).mockRejectedValue(new Error('MTA API Error'));

    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to get arrivals');
  });

  it('accepts all valid feed group IDs', async () => {
    const validGroups = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];

    for (const groupId of validGroups) {
      const request = new NextRequest(`http://localhost/api/v1/arrivals/${groupId}/101`);
      const response = await GET(request, {
        params: Promise.resolve({ groupId, stopId: '101' }),
      });

      expect(response.status).toBe(200);
    }
  });

  it('handles non-Error thrown values', async () => {
    vi.mocked(getArrivalBoard).mockRejectedValue('string error');

    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to get arrivals');
  });
});
