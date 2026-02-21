/**
 * Tests for path-to-trip conversion
 */

import { describe, it, expect } from 'vitest';
import { convertPathToTrip, generateDirections, getTripSummary } from '../path-converter';
import {
  createMockGraph,
  STATION_A,
  STATION_D,
  ROUTE_1,
  ROUTE_2,
} from './fixtures/mock-graph';
import {
  createSimplePath,
  createSingleTransferPath,
  createMinimalPath,
} from './fixtures/mock-paths';
import type { TransitGraph } from '../types';

describe('convertPathToTrip', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  describe('simple path (no transfers)', () => {
    it('creates board segment at origin', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      const boardSegment = trip.segments.find((s) => s.type === 'board');
      expect(boardSegment).toBeDefined();
      expect(boardSegment!.fromStation.id).toBe(STATION_A);
      expect(boardSegment!.routeId).toBe(ROUTE_1);
    });

    it('creates ride segment with stop count', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      const rideSegment = trip.segments.find((s) => s.type === 'ride');
      expect(rideSegment).toBeDefined();
      expect(rideSegment!.stopCount).toBeGreaterThan(0);
      expect(rideSegment!.routeId).toBe(ROUTE_1);
    });

    it('creates exit segment at destination', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      const exitSegment = trip.segments.find((s) => s.type === 'exit');
      expect(exitSegment).toBeDefined();
      expect(exitSegment!.toStation.id).toBe(STATION_D);
    });

    it('sets origin correctly', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.origin.id).toBe(STATION_A);
    });

    it('sets destination correctly', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.destination.id).toBe(STATION_D);
    });

    it('total duration matches path actual duration', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.totalDurationSeconds).toBe(path.actualDuration);
    });

    it('transfer count is 0', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.totalTransfers).toBe(0);
    });

    it('walking time is 0', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.totalWalkingSeconds).toBe(0);
    });

    it('routes array contains single route', () => {
      const path = createSimplePath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.routes).toContain(ROUTE_1);
      expect(trip.routes.length).toBe(1);
    });

    it('generates unique trip ID', () => {
      const path = createSimplePath();
      const trip1 = convertPathToTrip(graph, path);
      const trip2 = convertPathToTrip(graph, path);

      expect(trip1.id).toBeDefined();
      expect(trip2.id).toBeDefined();
      expect(trip1.id).not.toBe(trip2.id);
    });
  });

  describe('path with transfer', () => {
    it('creates transfer segment between rides', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      const transferSegment = trip.segments.find((s) => s.type === 'transfer');
      expect(transferSegment).toBeDefined();
    });

    it('transfer segment has correct walk time', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      const transferSegment = trip.segments.find((s) => s.type === 'transfer');
      expect(transferSegment!.durationSeconds).toBe(30); // TRANSFER_WALK_TIME
    });

    it('creates multiple board segments for different routes', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      const boardSegments = trip.segments.filter((s) => s.type === 'board');
      expect(boardSegments.length).toBe(2);
    });

    it('transfer count matches path transfer count', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.totalTransfers).toBe(1);
    });

    it('walking time equals sum of transfer durations', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.totalWalkingSeconds).toBe(30);
    });

    it('routes array contains both routes', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      expect(trip.routes).toContain(ROUTE_1);
      expect(trip.routes).toContain(ROUTE_2);
      expect(trip.routes.length).toBe(2);
    });

    it('segments are in correct order', () => {
      const path = createSingleTransferPath();
      const trip = convertPathToTrip(graph, path);

      // Expected order: board, ride, transfer, board, ride, exit
      const types = trip.segments.map((s) => s.type);
      expect(types[0]).toBe('board');
      expect(types[types.length - 1]).toBe('exit');

      // Transfer should be between rides
      const transferIndex = types.indexOf('transfer');
      expect(transferIndex).toBeGreaterThan(0);
      expect(transferIndex).toBeLessThan(types.length - 1);
    });
  });

  describe('minimal path', () => {
    it('works with 2-station path', () => {
      const minimal = createMinimalPath();
      const trip = convertPathToTrip(graph, minimal);

      expect(trip.segments.length).toBeGreaterThanOrEqual(2);
      expect(trip.origin.id).toBe('X');
      expect(trip.destination.id).toBe('Y');
    });
  });
});

describe('generateDirections', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns array of strings', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    expect(Array.isArray(directions)).toBe(true);
    expect(directions.every((d) => typeof d === 'string')).toBe(true);
  });

  it('board text includes route and station', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    const boardDirection = directions.find((d) => d.includes('Board'));
    expect(boardDirection).toBeDefined();
    expect(boardDirection).toContain(ROUTE_1);
    expect(boardDirection).toContain('Station A');
  });

  it('ride text includes stop count', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    const rideDirection = directions.find((d) => d.includes('Ride'));
    expect(rideDirection).toBeDefined();
    expect(rideDirection).toMatch(/\d+ stop/);
  });

  it('ride text includes duration', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    const rideDirection = directions.find((d) => d.includes('Ride'));
    expect(rideDirection).toContain('min');
  });

  it('transfer text includes walk time', () => {
    const path = createSingleTransferPath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    const transferDirection = directions.find(
      (d) => d.includes('Transfer') || d.includes('Walk')
    );
    expect(transferDirection).toBeDefined();
    expect(transferDirection).toContain('min');
  });

  it('exit text includes destination', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    const exitDirection = directions.find((d) => d.includes('Arrive'));
    expect(exitDirection).toBeDefined();
    expect(exitDirection).toContain('Station D');
  });

  it('direction count matches segment count', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const directions = generateDirections(trip);

    expect(directions.length).toBe(trip.segments.length);
  });
});

describe('getTripSummary', () => {
  let graph: TransitGraph;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns a string', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(typeof summary).toBe('string');
  });

  it('includes duration in minutes', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(summary).toContain('min');
    expect(summary).toMatch(/\d+\s*min/);
  });

  it('includes route list', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(summary).toContain(ROUTE_1);
  });

  it('shows "no transfers" for 0 transfers', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(summary).toContain('no transfers');
  });

  it('shows "1 transfer" for singular', () => {
    const path = createSingleTransferPath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(summary).toContain('1 transfer');
    expect(summary).not.toContain('transfers');
  });

  it('includes "via" keyword', () => {
    const path = createSimplePath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(summary).toContain('via');
  });

  it('includes multiple routes when path has transfers', () => {
    const path = createSingleTransferPath();
    const trip = convertPathToTrip(graph, path);
    const summary = getTripSummary(trip);

    expect(summary).toContain(ROUTE_1);
    expect(summary).toContain(ROUTE_2);
  });
});

// Import beforeEach
import { beforeEach } from 'vitest';
