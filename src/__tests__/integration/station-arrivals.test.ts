import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTrainsStore } from '@/stores';
import { createMockTrainPosition } from '@/test/factories';

/**
 * Integration tests for train tracking system
 *
 * Note: Station data is now fetched via React Query (use-static-data.ts).
 * Arrivals are fetched via React Query (use-arrivals.ts).
 * These tests focus on train position tracking via Zustand.
 */
describe('Train Tracking Integration', () => {
  beforeEach(() => {
    useTrainsStore.setState({
      trains: {},
    });
    vi.clearAllMocks();
  });

  describe('station-train relationship', () => {
    it('associates trains with their next stop', () => {
      const positions = [
        createMockTrainPosition({
          tripId: 'trip-1',
          routeId: 'A',
          nextStopId: '101N',
          nextStopName: 'Times Square',
        }),
      ];

      useTrainsStore.getState().updateTrains(positions);

      const trains = useTrainsStore.getState().trains;
      expect(trains['trip-1'].nextStopId).toBe('101N');
    });

    it('tracks multiple trains approaching same station', () => {
      const positions = [
        createMockTrainPosition({
          tripId: 'trip-1',
          routeId: 'A',
          nextStopId: '101N',
        }),
        createMockTrainPosition({
          tripId: 'trip-2',
          routeId: 'C',
          nextStopId: '101N',
        }),
      ];

      useTrainsStore.getState().updateTrains(positions);

      const allTrains = Object.values(useTrainsStore.getState().trains);
      const approaching101 = allTrains.filter((t) => t.nextStopId === '101N');

      expect(approaching101).toHaveLength(2);
    });

    it('filters trains by route', () => {
      const positions = [
        createMockTrainPosition({ tripId: 'trip-a', routeId: 'A' }),
        createMockTrainPosition({ tripId: 'trip-c', routeId: 'C' }),
        createMockTrainPosition({ tripId: 'trip-1', routeId: '1' }),
      ];

      useTrainsStore.getState().updateTrains(positions);

      const routeATrains = useTrainsStore.getState().getTrainsByRoute('A');
      expect(routeATrains).toHaveLength(1);
      expect(routeATrains[0].tripId).toBe('trip-a');
    });
  });
});
