import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import * as mta from '@/lib/mta';
import type { ArrivalItem } from '@/types/mta';

// Mock the MTA library
vi.mock('@/lib/mta', () => ({
  getArrivalsForStop: vi.fn(),
}));

const mockGetArrivalsForStop = vi.mocked(mta.getArrivalsForStop);

// Helper to create a mock ArrivalItem
function createMockArrival(overrides: Partial<ArrivalItem> = {}): ArrivalItem {
  return {
    stopId: '101N',
    stopName: 'Test Station',
    whenISO: new Date(Date.now() + 5 * 60000).toISOString(),
    whenLocal: null,
    in: '5 min',
    routeId: '1',
    tripId: `trip-${Math.random().toString(36).slice(2)}`,
    scheduleRelationship: 'SCHEDULED',
    meta: {
      arrivalDelay: null,
      departureDelay: null,
    },
    ...overrides,
  };
}

describe('GET /api/v1/arrivals/station/[stationId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns arrivals for both directions', async () => {
    const northArrivals = [
      createMockArrival({ stopId: '101N', tripId: 'trip-1' }),
      createMockArrival({ stopId: '101N', tripId: 'trip-2' }),
    ];
    const southArrivals = [
      createMockArrival({ stopId: '101S', tripId: 'trip-3' }),
    ];

    mockGetArrivalsForStop
      .mockResolvedValueOnce(northArrivals) // North
      .mockResolvedValueOnce(southArrivals); // South

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101');
    const response = await GET(request, { params: Promise.resolve({ stationId: '101' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stationId).toBe('101');
    expect(data.arrivals).toHaveLength(3);
    expect(data.updatedAt).toBeDefined();
    expect(mockGetArrivalsForStop).toHaveBeenCalledTimes(2);
    expect(mockGetArrivalsForStop).toHaveBeenCalledWith('101N', { useCache: true });
    expect(mockGetArrivalsForStop).toHaveBeenCalledWith('101S', { useCache: true });
  });

  it('sorts arrivals by time', async () => {
    const now = Date.now();
    const earlyArrival = createMockArrival({
      stopId: '101S',
      tripId: 'trip-early',
      whenISO: new Date(now + 2 * 60000).toISOString(),
    });
    const lateArrival = createMockArrival({
      stopId: '101N',
      tripId: 'trip-late',
      whenISO: new Date(now + 10 * 60000).toISOString(),
    });

    mockGetArrivalsForStop
      .mockResolvedValueOnce([lateArrival]) // North - later
      .mockResolvedValueOnce([earlyArrival]); // South - earlier

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101');
    const response = await GET(request, { params: Promise.resolve({ stationId: '101' }) });
    const data = await response.json();

    expect(data.arrivals[0].tripId).toBe('trip-early');
    expect(data.arrivals[1].tripId).toBe('trip-late');
  });

  it('deduplicates arrivals by tripId+stopId', async () => {
    const duplicateArrival = createMockArrival({
      stopId: '101N',
      tripId: 'trip-dupe',
    });

    mockGetArrivalsForStop
      .mockResolvedValueOnce([duplicateArrival, duplicateArrival]) // Duplicates from north
      .mockResolvedValueOnce([]);

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101');
    const response = await GET(request, { params: Promise.resolve({ stationId: '101' }) });
    const data = await response.json();

    expect(data.arrivals).toHaveLength(1);
  });

  it('respects nocache query parameter', async () => {
    mockGetArrivalsForStop.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101?nocache=true');
    await GET(request, { params: Promise.resolve({ stationId: '101' }) });

    expect(mockGetArrivalsForStop).toHaveBeenCalledWith('101N', { useCache: false });
    expect(mockGetArrivalsForStop).toHaveBeenCalledWith('101S', { useCache: false });
  });

  it('returns empty arrivals when no trains', async () => {
    mockGetArrivalsForStop.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101');
    const response = await GET(request, { params: Promise.resolve({ stationId: '101' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.arrivals).toEqual([]);
  });

  it('handles errors gracefully', async () => {
    mockGetArrivalsForStop.mockRejectedValue(new Error('Network error'));

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101');
    const response = await GET(request, { params: Promise.resolve({ stationId: '101' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.message).toBe('Network error');
  });

  it('handles non-Error thrown values', async () => {
    mockGetArrivalsForStop.mockRejectedValue('string error');

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/101');
    const response = await GET(request, { params: Promise.resolve({ stationId: '101' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.message).toBe('Failed to get arrivals');
  });

  it('correctly builds stop IDs from station ID', async () => {
    mockGetArrivalsForStop.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/v1/arrivals/station/A32');
    await GET(request, { params: Promise.resolve({ stationId: 'A32' }) });

    expect(mockGetArrivalsForStop).toHaveBeenCalledWith('A32N', expect.any(Object));
    expect(mockGetArrivalsForStop).toHaveBeenCalledWith('A32S', expect.any(Object));
  });
});
