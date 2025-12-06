import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { createMockFeedEntity } from '@/test/factories';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  fetchFeed: vi.fn(),
}));

import { fetchFeed } from '@/lib/mta';

describe('GET /api/v1/feed/[groupId]', () => {
  const mockFeed = {
    timestamp: new Date().toISOString(),
    entities: [
      createMockFeedEntity({ routeId: 'A' }),
      createMockFeedEntity({ routeId: 'C' }),
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (fetchFeed as any).mockResolvedValue(mockFeed);
  });

  it('returns feed data for valid group ID', async () => {
    const request = new NextRequest('http://localhost/api/v1/feed/ACE');
    const response = await GET(request, { params: Promise.resolve({ groupId: 'ACE' }) });
    const data = await response.json();

    expect(data.entities).toHaveLength(2);
    expect(fetchFeed).toHaveBeenCalledWith('ACE', { useCache: true });
  });

  it('accepts all valid feed group IDs', async () => {
    const validGroups = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];

    for (const groupId of validGroups) {
      (fetchFeed as any).mockResolvedValue(mockFeed);
      const request = new NextRequest(`http://localhost/api/v1/feed/${groupId}`);
      const response = await GET(request, { params: Promise.resolve({ groupId }) });

      expect(response.status).toBe(200);
    }
  });

  it('handles invalid feed group ID gracefully', async () => {
    // Route passes through to fetch - invalid IDs handled by MTA library
    (fetchFeed as any).mockRejectedValue(new Error('Invalid feed group'));
    const request = new NextRequest('http://localhost/api/v1/feed/INVALID');
    const response = await GET(request, { params: Promise.resolve({ groupId: 'INVALID' }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Invalid feed group');
  });

  it('bypasses cache when nocache=true', async () => {
    const request = new NextRequest('http://localhost/api/v1/feed/ACE?nocache=true');
    await GET(request, { params: Promise.resolve({ groupId: 'ACE' }) });

    expect(fetchFeed).toHaveBeenCalledWith('ACE', { useCache: false });
  });

  it('uses cache by default', async () => {
    const request = new NextRequest('http://localhost/api/v1/feed/ACE');
    await GET(request, { params: Promise.resolve({ groupId: 'ACE' }) });

    expect(fetchFeed).toHaveBeenCalledWith('ACE', { useCache: true });
  });

  it('returns 500 on fetch error', async () => {
    (fetchFeed as any).mockRejectedValue(new Error('MTA API Error'));

    const request = new NextRequest('http://localhost/api/v1/feed/ACE');
    const response = await GET(request, { params: Promise.resolve({ groupId: 'ACE' }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('MTA API Error');
  });

  it('handles non-Error thrown values', async () => {
    (fetchFeed as any).mockRejectedValue('string error');

    const request = new NextRequest('http://localhost/api/v1/feed/ACE');
    const response = await GET(request, { params: Promise.resolve({ groupId: 'ACE' }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to fetch feed');
  });

  it('handles empty group ID gracefully', async () => {
    // Empty group ID will fail at MTA API level
    (fetchFeed as any).mockRejectedValue(new Error('Feed group required'));
    const request = new NextRequest('http://localhost/api/v1/feed/');
    const response = await GET(request, { params: Promise.resolve({ groupId: '' }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.code).toBe('INTERNAL_ERROR');
  });
});
