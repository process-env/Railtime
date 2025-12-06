import { describe, it, expect, beforeEach } from 'vitest';
import { useTrainsStore } from './trains-store';
import { createMockTrainPosition } from '@/test/factories';

describe('useTrainsStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useTrainsStore.setState({
      trains: {},
    });
  });

  describe('initial state', () => {
    it('has empty trains map', () => {
      expect(useTrainsStore.getState().trains).toEqual({});
    });
  });

  describe('updateTrains', () => {
    it('adds new trains to store', () => {
      const train1 = createMockTrainPosition({ tripId: 'trip1', routeId: 'A' });
      const train2 = createMockTrainPosition({ tripId: 'trip2', routeId: 'B' });

      useTrainsStore.getState().updateTrains([train1, train2]);

      const { trains } = useTrainsStore.getState();
      expect(trains['trip1']).toEqual(train1);
      expect(trains['trip2']).toEqual(train2);
    });

    it('updates existing trains', () => {
      const train = createMockTrainPosition({ tripId: 'trip1', routeId: 'A', lat: 40.7 });
      useTrainsStore.getState().updateTrains([train]);

      const updatedTrain = createMockTrainPosition({ tripId: 'trip1', routeId: 'A', lat: 40.8 });
      useTrainsStore.getState().updateTrains([updatedTrain]);

      const { trains } = useTrainsStore.getState();
      expect(trains['trip1'].lat).toBe(40.8);
    });

    it('preserves existing trains when adding new ones', () => {
      const train1 = createMockTrainPosition({ tripId: 'trip1', routeId: 'A' });
      useTrainsStore.getState().updateTrains([train1]);

      const train2 = createMockTrainPosition({ tripId: 'trip2', routeId: 'B' });
      useTrainsStore.getState().updateTrains([train2]);

      const { trains } = useTrainsStore.getState();
      expect(Object.keys(trains)).toHaveLength(2);
      expect(trains['trip1']).toBeDefined();
      expect(trains['trip2']).toBeDefined();
    });

    it('handles empty array', () => {
      useTrainsStore.getState().updateTrains([]);
      expect(useTrainsStore.getState().trains).toEqual({});
    });
  });

  describe('clearTrains', () => {
    it('removes all trains', () => {
      const train1 = createMockTrainPosition({ tripId: 'trip1' });
      const train2 = createMockTrainPosition({ tripId: 'trip2' });
      useTrainsStore.getState().updateTrains([train1, train2]);

      useTrainsStore.getState().clearTrains();

      expect(useTrainsStore.getState().trains).toEqual({});
    });
  });

  describe('getTrainsByRoute', () => {
    it('filters trains by route ID', () => {
      useTrainsStore.getState().updateTrains([
        createMockTrainPosition({ tripId: 'trip1', routeId: 'A' }),
        createMockTrainPosition({ tripId: 'trip2', routeId: 'A' }),
        createMockTrainPosition({ tripId: 'trip3', routeId: 'B' }),
      ]);

      const aTrains = useTrainsStore.getState().getTrainsByRoute('A');
      expect(aTrains).toHaveLength(2);
      expect(aTrains.every((t) => t.routeId === 'A')).toBe(true);
    });

    it('is case-insensitive', () => {
      useTrainsStore.getState().updateTrains([
        createMockTrainPosition({ tripId: 'trip1', routeId: 'A' }),
      ]);

      const trains = useTrainsStore.getState().getTrainsByRoute('a');
      expect(trains).toHaveLength(1);
    });

    it('returns empty array for no matches', () => {
      useTrainsStore.getState().updateTrains([
        createMockTrainPosition({ tripId: 'trip1', routeId: 'A' }),
      ]);

      const trains = useTrainsStore.getState().getTrainsByRoute('Z');
      expect(trains).toEqual([]);
    });

    it('returns empty array when no trains', () => {
      const trains = useTrainsStore.getState().getTrainsByRoute('A');
      expect(trains).toEqual([]);
    });
  });
});
