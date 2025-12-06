import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { createMockArrivalBoard } from '@/test/factories';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  getArrivalBoard: vi.fn(),
}));

import { getArrivalBoard } from '@/lib/mta';

describe('GET /api/v1/arrivals/[groupId]/[stopId]', () => {
  const mockBoard = createMockArrivalBoard();

  beforeEach(() => {
    vi.clearAllMocks();
    (getArrivalBoard as any).mockResolvedValue(mockBoard);
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
    // Invalid group IDs are handled by MTA library, not route validation
    (getArrivalBoard as any).mockRejectedValue(new Error('Invalid feed group'));
    const request = new NextRequest('http://localhost/api/v1/arrivals/INVALID/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'INVALID', stopId: 'A24N' }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Invalid feed group');
  });

  it('handles invalid stop ID gracefully', async () => {
    // Invalid stop IDs are handled by MTA library, not route validation
    (getArrivalBoard as any).mockRejectedValue(new Error('Stop not found'));
    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/INVALID!!');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'INVALID!!' }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Stop not found');
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

  it('returns 500 on fetch error', async () => {
    (getArrivalBoard as any).mockRejectedValue(new Error('MTA API Error'));

    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('MTA API Error');
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
    (getArrivalBoard as any).mockRejectedValue('string error');

    const request = new NextRequest('http://localhost/api/v1/arrivals/ACE/A24N');
    const response = await GET(request, {
      params: Promise.resolve({ groupId: 'ACE', stopId: 'A24N' }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to get arrivals');
  });
});
