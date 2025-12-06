import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { createMockStop } from '@/test/factories';

// Mock the MTA lib
vi.mock('@/lib/mta', () => ({
  searchStops: vi.fn(),
}));

import { searchStops } from '@/lib/mta';

describe('GET /api/v1/stops', () => {
  const mockStops = [
    createMockStop({ name: 'Times Square', routes: 'A,C,E,1,2,3' }),
    createMockStop({ name: 'Penn Station', routes: 'A,C,E' }),
    createMockStop({ name: '14 St', routes: '1,2,3' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (searchStops as any).mockResolvedValue(mockStops);
  });

  it('returns all stops when no filters', async () => {
    const request = new NextRequest('http://localhost/api/v1/stops');
    const response = await GET(request);
    const data = await response.json();

    expect(data).toHaveLength(3);
    expect(searchStops).toHaveBeenCalledWith(undefined, undefined);
  });

  it('searches stops by query', async () => {
    const request = new NextRequest('http://localhost/api/v1/stops?query=Times');
    await GET(request);

    expect(searchStops).toHaveBeenCalledWith('Times', undefined);
  });

  it('filters stops by route', async () => {
    const request = new NextRequest('http://localhost/api/v1/stops?route=A');
    await GET(request);

    expect(searchStops).toHaveBeenCalledWith(undefined, 'A');
  });

  it('combines query and route filters', async () => {
    const request = new NextRequest('http://localhost/api/v1/stops?query=Times&route=A');
    await GET(request);

    expect(searchStops).toHaveBeenCalledWith('Times', 'A');
  });

  it('returns 400 for invalid route ID format', async () => {
    // Route validation: max 10 chars, A-Z0-9 only
    const request = new NextRequest('http://localhost/api/v1/stops?route=INVALID!!');
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.message).toContain('Invalid route ID format');
  });

  it('returns all stops from search (no route-level limit)', async () => {
    // Limit is now applied within searchStops, not at route level
    const manyStops = Array.from({ length: 150 }, (_, i) =>
      createMockStop({ name: `Stop ${i}` })
    );
    (searchStops as any).mockResolvedValue(manyStops);

    const request = new NextRequest('http://localhost/api/v1/stops');
    const response = await GET(request);
    const data = await response.json();

    expect(data).toHaveLength(150);
  });

  it('returns 500 on search error', async () => {
    (searchStops as any).mockRejectedValue(new Error('Database error'));

    const request = new NextRequest('http://localhost/api/v1/stops');
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.message).toBe('Failed to search stops');
  });

  it('handles empty results', async () => {
    (searchStops as any).mockResolvedValue([]);

    const request = new NextRequest('http://localhost/api/v1/stops?query=NonExistent');
    const response = await GET(request);
    const data = await response.json();

    expect(data).toHaveLength(0);
  });

  it('accepts valid 3-character route IDs', async () => {
    const request = new NextRequest('http://localhost/api/v1/stops?route=SIR');
    await GET(request);

    expect(searchStops).toHaveBeenCalledWith(undefined, 'SIR');
  });
});
