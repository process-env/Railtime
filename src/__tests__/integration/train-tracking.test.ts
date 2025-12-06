import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTrainsStore } from '@/stores';
import { createMockTrainPosition } from '@/test/factories';

/**
 * Integration tests for the train tracking system
 * Tests the flow from feed data to store updates
 *
 * Note: Arrivals and feed timestamps are now handled by React Query,
 * not stored in Zustand. These tests focus on train position tracking.
 */
describe('Train Tracking Integration', () => {
  beforeEach(() => {
    // Reset store using setState
    useTrainsStore.setState({
      trains: {},
    });
    vi.clearAllMocks();
  });

  describe('train position updates', () => {
    it('updates store with new train positions', () => {
      const positions = [createMockTrainPosition({ tripId: 'trip-1', routeId: 'A' })];

      useTrainsStore.getState().updateTrains(positions);

      const trains = useTrainsStore.getState().trains;
      expect(trains['trip-1']).toBeDefined();
      expect(trains['trip-1'].routeId).toBe('A');
    });

    it('updates existing train position', () => {
      const initial = [
        createMockTrainPosition({
          tripId: 'trip-1',
          lat: 40.7,
          lon: -73.9,
        }),
      ];
      const updated = [
        createMockTrainPosition({
          tripId: 'trip-1',
          lat: 40.8,
          lon: -73.8,
        }),
      ];

      useTrainsStore.getState().updateTrains(initial);
      useTrainsStore.getState().updateTrains(updated);

      const train = useTrainsStore.getState().trains['trip-1'];
      expect(train.lat).toBe(40.8);
      expect(train.lon).toBe(-73.8);
    });

    it('clears all trains', () => {
      const positions = [
        createMockTrainPosition({ tripId: 'trip-1' }),
        createMockTrainPosition({ tripId: 'trip-2' }),
      ];

      useTrainsStore.getState().updateTrains(positions);
      expect(Object.keys(useTrainsStore.getState().trains)).toHaveLength(2);

      useTrainsStore.getState().clearTrains();

      const trains = useTrainsStore.getState().trains;
      expect(Object.keys(trains)).toHaveLength(0);
    });

    it('tracks multiple routes simultaneously', () => {
      const positions = [
        createMockTrainPosition({ tripId: 'trip-a', routeId: 'A' }),
        createMockTrainPosition({ tripId: 'trip-c', routeId: 'C' }),
        createMockTrainPosition({ tripId: 'trip-1', routeId: '1' }),
      ];

      useTrainsStore.getState().updateTrains(positions);

      const trains = useTrainsStore.getState().trains;
      expect(Object.keys(trains)).toHaveLength(3);

      const byRoute = useTrainsStore.getState().getTrainsByRoute('A');
      expect(byRoute).toHaveLength(1);
      expect(byRoute[0].routeId).toBe('A');
    });
  });

  describe('route filtering', () => {
    it('filters trains by route case-insensitively', () => {
      const positions = [
        createMockTrainPosition({ tripId: 'trip-a1', routeId: 'A' }),
        createMockTrainPosition({ tripId: 'trip-a2', routeId: 'A' }),
        createMockTrainPosition({ tripId: 'trip-c', routeId: 'C' }),
      ];

      useTrainsStore.getState().updateTrains(positions);

      const aTrains = useTrainsStore.getState().getTrainsByRoute('a');
      expect(aTrains).toHaveLength(2);
    });

    it('returns empty array for unknown route', () => {
      const positions = [createMockTrainPosition({ tripId: 'trip-a', routeId: 'A' })];

      useTrainsStore.getState().updateTrains(positions);

      const zTrains = useTrainsStore.getState().getTrainsByRoute('Z');
      expect(zTrains).toEqual([]);
    });
  });
});
