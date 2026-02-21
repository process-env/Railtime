/**
 * Tests for Trip Planning API endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import type { TripPlan } from '@/lib/trip-planner/types';

// Mock the trip-planner module
vi.mock('@/lib/trip-planner', () => ({
  getAlternativeTrips: vi.fn(),
}));

import { getAlternativeTrips } from '@/lib/trip-planner';

// Helper to create NextRequest with query params
function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/trip');
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

// Mock trip plans for testing
const mockTrip1: TripPlan = {
  id: 'trip-1',
  origin: { id: '127', name: 'Times Square' },
  destination: { id: '635', name: 'Union Square' },
  segments: [
    {
      type: 'board',
      routeId: '1',
      fromStation: { id: '127', name: 'Times Square' },
      toStation: { id: '127', name: 'Times Square' },
      durationSeconds: 0,
    },
    {
      type: 'ride',
      routeId: '1',
      fromStation: { id: '127', name: 'Times Square' },
      toStation: { id: '635', name: 'Union Square' },
      durationSeconds: 420,
      stopCount: 7,
    },
    {
      type: 'exit',
      fromStation: { id: '635', name: 'Union Square' },
      toStation: { id: '635', name: 'Union Square' },
      durationSeconds: 0,
    },
  ],
  totalDurationSeconds: 420,
  totalTransfers: 0,
  totalWalkingSeconds: 0,
  routes: ['1'],
};

const mockTrip2: TripPlan = {
  id: 'trip-2',
  origin: { id: '127', name: 'Times Square' },
  destination: { id: '635', name: 'Union Square' },
  segments: [],
  totalDurationSeconds: 480,
  totalTransfers: 1,
  totalWalkingSeconds: 60,
  routes: ['N', 'L'],
};

describe('GET /api/v1/trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAlternativeTrips).mockResolvedValue([mockTrip1, mockTrip2]);
  });

  describe('successful requests', () => {
    it('returns trips for valid origin and destination', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.trips).toHaveLength(2);
      expect(data.origin).toBe('127');
      expect(data.destination).toBe('635');
    });

    it('includes requestedAt timestamp', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(data.requestedAt).toBeDefined();
      expect(new Date(data.requestedAt)).toBeInstanceOf(Date);
    });

    it('returns trips with correct structure', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      const response = await GET(request);
      const data = await response.json();

      const trip = data.trips[0];
      expect(trip.id).toBeDefined();
      expect(trip.origin.id).toBe('127');
      expect(trip.destination.id).toBe('635');
      expect(trip.totalDurationSeconds).toBe(420);
      expect(trip.routes).toContain('1');
    });
  });

  describe('missing parameters', () => {
    it('returns 400 for missing origin', async () => {
      const request = createRequest({
        destination: '635',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('BAD_REQUEST');
      expect(data.error.message).toContain('origin');
    });

    it('returns 400 for missing destination', async () => {
      const request = createRequest({
        origin: '127',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('BAD_REQUEST');
      expect(data.error.message).toContain('destination');
    });

    it('returns 400 for same origin and destination', async () => {
      const request = createRequest({
        origin: '127',
        destination: '127',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('BAD_REQUEST');
      expect(data.error.message).toContain('same');
    });
  });

  describe('no routes found', () => {
    it('returns 404 when no trips found', async () => {
      vi.mocked(getAlternativeTrips).mockResolvedValue([]);

      const request = createRequest({
        origin: '127',
        destination: '999',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('No routes found');
    });
  });

  describe('alternatives parameter', () => {
    it('passes alternatives count to trip planner', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        alternatives: '5',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        5,
        expect.any(Object)
      );
    });

    it('defaults to 3 alternatives', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.any(Object)
      );
    });

    it('caps alternatives at 5', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        alternatives: '10',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        5,
        expect.any(Object)
      );
    });

    it('ensures minimum of 1 alternative', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        alternatives: '0',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        1,
        expect.any(Object)
      );
    });
  });

  describe('maxTransfers parameter', () => {
    it('passes maxTransfers to trip planner', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        maxTransfers: '2',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ maxTransfers: 2 })
      );
    });

    it('defaults to 3 max transfers', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ maxTransfers: 3 })
      );
    });

    it('caps maxTransfers at 5', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        maxTransfers: '10',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ maxTransfers: 5 })
      );
    });

    it('allows 0 transfers', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        maxTransfers: '0',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ maxTransfers: 0 })
      );
    });
  });

  describe('avoidRoutes parameter', () => {
    it('passes avoidRoutes to trip planner', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        avoidRoutes: 'A,C,E',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ avoidRoutes: ['A', 'C', 'E'] })
      );
    });

    it('converts avoidRoutes to uppercase', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        avoidRoutes: 'a,c,e',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ avoidRoutes: ['A', 'C', 'E'] })
      );
    });

    it('handles single route to avoid', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        avoidRoutes: 'L',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ avoidRoutes: ['L'] })
      );
    });

    it('trims whitespace from routes', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
        avoidRoutes: ' A , C , E ',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ avoidRoutes: ['A', 'C', 'E'] })
      );
    });

    it('defaults to empty avoidRoutes', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ avoidRoutes: [] })
      );
    });
  });

  describe('preferFewerTransfers option', () => {
    it('always passes preferFewerTransfers: true', async () => {
      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      await GET(request);

      expect(getAlternativeTrips).toHaveBeenCalledWith(
        '127',
        '635',
        3,
        expect.objectContaining({ preferFewerTransfers: true })
      );
    });
  });

  describe('error handling', () => {
    it('returns 500 on internal error', async () => {
      vi.mocked(getAlternativeTrips).mockRejectedValue(new Error('Database error'));

      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe('INTERNAL_ERROR');
      expect(data.error.message).toBe('Database error');
    });

    it('handles non-Error exceptions', async () => {
      vi.mocked(getAlternativeTrips).mockRejectedValue('Unknown error');

      const request = createRequest({
        origin: '127',
        destination: '635',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe('INTERNAL_ERROR');
      expect(data.error.message).toBe('Failed to plan trip');
    });
  });
});
