/**
 * Tests for trip planner Zustand store
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTripStore } from './trip-store';
import type { TripPlan } from '@/lib/trip-planner/types';

// Mock trip plan for testing
const mockTrip: TripPlan = {
  id: 'trip-1',
  origin: { id: 'A', name: 'Station A' },
  destination: { id: 'D', name: 'Station D' },
  segments: [
    {
      type: 'board',
      routeId: '1',
      fromStation: { id: 'A', name: 'Station A' },
      toStation: { id: 'A', name: 'Station A' },
      durationSeconds: 0,
    },
    {
      type: 'ride',
      routeId: '1',
      fromStation: { id: 'A', name: 'Station A' },
      toStation: { id: 'D', name: 'Station D' },
      durationSeconds: 180,
      stopCount: 3,
    },
    {
      type: 'exit',
      fromStation: { id: 'D', name: 'Station D' },
      toStation: { id: 'D', name: 'Station D' },
      durationSeconds: 0,
    },
  ],
  totalDurationSeconds: 180,
  totalTransfers: 0,
  totalWalkingSeconds: 0,
  routes: ['1'],
};

const mockTrip2: TripPlan = {
  id: 'trip-2',
  origin: { id: 'A', name: 'Station A' },
  destination: { id: 'F', name: 'Station F' },
  segments: [],
  totalDurationSeconds: 360,
  totalTransfers: 1,
  totalWalkingSeconds: 30,
  routes: ['1', '2'],
};

describe('useTripStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useTripStore.setState({
      originStationId: null,
      destinationStationId: null,
      trips: [],
      selectedTripIndex: 0,
      isPlanning: false,
      error: null,
      isPanelOpen: false,
    });
  });

  describe('initial state', () => {
    it('has no origin station', () => {
      expect(useTripStore.getState().originStationId).toBeNull();
    });

    it('has no destination station', () => {
      expect(useTripStore.getState().destinationStationId).toBeNull();
    });

    it('has empty trips array', () => {
      expect(useTripStore.getState().trips).toEqual([]);
    });

    it('has selected trip index 0', () => {
      expect(useTripStore.getState().selectedTripIndex).toBe(0);
    });

    it('is not planning', () => {
      expect(useTripStore.getState().isPlanning).toBe(false);
    });

    it('has no error', () => {
      expect(useTripStore.getState().error).toBeNull();
    });

    it('has panel closed', () => {
      expect(useTripStore.getState().isPanelOpen).toBe(false);
    });
  });

  describe('setOrigin', () => {
    it('sets origin station ID', () => {
      useTripStore.getState().setOrigin('127');
      expect(useTripStore.getState().originStationId).toBe('127');
    });

    it('clears origin with null', () => {
      useTripStore.setState({ originStationId: '127' });
      useTripStore.getState().setOrigin(null);
      expect(useTripStore.getState().originStationId).toBeNull();
    });

    it('clears trips when origin changes', () => {
      useTripStore.setState({ trips: [mockTrip] });
      useTripStore.getState().setOrigin('127');
      expect(useTripStore.getState().trips).toEqual([]);
    });

    it('clears error when origin changes', () => {
      useTripStore.setState({ error: 'Some error' });
      useTripStore.getState().setOrigin('127');
      expect(useTripStore.getState().error).toBeNull();
    });
  });

  describe('setDestination', () => {
    it('sets destination station ID', () => {
      useTripStore.getState().setDestination('635');
      expect(useTripStore.getState().destinationStationId).toBe('635');
    });

    it('clears destination with null', () => {
      useTripStore.setState({ destinationStationId: '635' });
      useTripStore.getState().setDestination(null);
      expect(useTripStore.getState().destinationStationId).toBeNull();
    });

    it('clears trips when destination changes', () => {
      useTripStore.setState({ trips: [mockTrip] });
      useTripStore.getState().setDestination('635');
      expect(useTripStore.getState().trips).toEqual([]);
    });

    it('clears error when destination changes', () => {
      useTripStore.setState({ error: 'Some error' });
      useTripStore.getState().setDestination('635');
      expect(useTripStore.getState().error).toBeNull();
    });
  });

  describe('swapStations', () => {
    it('swaps origin and destination', () => {
      useTripStore.setState({
        originStationId: '127',
        destinationStationId: '635',
      });
      useTripStore.getState().swapStations();

      expect(useTripStore.getState().originStationId).toBe('635');
      expect(useTripStore.getState().destinationStationId).toBe('127');
    });

    it('handles null origin', () => {
      useTripStore.setState({
        originStationId: null,
        destinationStationId: '635',
      });
      useTripStore.getState().swapStations();

      expect(useTripStore.getState().originStationId).toBe('635');
      expect(useTripStore.getState().destinationStationId).toBeNull();
    });

    it('handles null destination', () => {
      useTripStore.setState({
        originStationId: '127',
        destinationStationId: null,
      });
      useTripStore.getState().swapStations();

      expect(useTripStore.getState().originStationId).toBeNull();
      expect(useTripStore.getState().destinationStationId).toBe('127');
    });

    it('clears trips when swapping', () => {
      useTripStore.setState({
        originStationId: '127',
        destinationStationId: '635',
        trips: [mockTrip],
      });
      useTripStore.getState().swapStations();
      expect(useTripStore.getState().trips).toEqual([]);
    });

    it('clears error when swapping', () => {
      useTripStore.setState({
        originStationId: '127',
        destinationStationId: '635',
        error: 'Some error',
      });
      useTripStore.getState().swapStations();
      expect(useTripStore.getState().error).toBeNull();
    });
  });

  describe('setTrips', () => {
    it('sets trips array', () => {
      useTripStore.getState().setTrips([mockTrip, mockTrip2]);
      expect(useTripStore.getState().trips).toHaveLength(2);
      expect(useTripStore.getState().trips[0].id).toBe('trip-1');
    });

    it('resets selected trip index to 0', () => {
      useTripStore.setState({ selectedTripIndex: 2 });
      useTripStore.getState().setTrips([mockTrip]);
      expect(useTripStore.getState().selectedTripIndex).toBe(0);
    });

    it('clears error when setting trips', () => {
      useTripStore.setState({ error: 'Previous error' });
      useTripStore.getState().setTrips([mockTrip]);
      expect(useTripStore.getState().error).toBeNull();
    });

    it('sets empty array', () => {
      useTripStore.setState({ trips: [mockTrip] });
      useTripStore.getState().setTrips([]);
      expect(useTripStore.getState().trips).toEqual([]);
    });
  });

  describe('selectTrip', () => {
    beforeEach(() => {
      useTripStore.setState({ trips: [mockTrip, mockTrip2] });
    });

    it('sets selected trip index', () => {
      useTripStore.getState().selectTrip(1);
      expect(useTripStore.getState().selectedTripIndex).toBe(1);
    });

    it('sets index 0', () => {
      useTripStore.setState({ selectedTripIndex: 1 });
      useTripStore.getState().selectTrip(0);
      expect(useTripStore.getState().selectedTripIndex).toBe(0);
    });

    it('allows index beyond trips length', () => {
      useTripStore.getState().selectTrip(5);
      expect(useTripStore.getState().selectedTripIndex).toBe(5);
    });
  });

  describe('isPlanning', () => {
    it('sets planning state to true', () => {
      useTripStore.getState().setIsPlanning(true);
      expect(useTripStore.getState().isPlanning).toBe(true);
    });

    it('sets planning state to false', () => {
      useTripStore.setState({ isPlanning: true });
      useTripStore.getState().setIsPlanning(false);
      expect(useTripStore.getState().isPlanning).toBe(false);
    });
  });

  describe('error', () => {
    it('sets error message', () => {
      useTripStore.getState().setError('No routes found');
      expect(useTripStore.getState().error).toBe('No routes found');
    });

    it('clears error with null', () => {
      useTripStore.setState({ error: 'Some error' });
      useTripStore.getState().setError(null);
      expect(useTripStore.getState().error).toBeNull();
    });
  });

  describe('panel state', () => {
    it('opens panel', () => {
      useTripStore.getState().setIsPanelOpen(true);
      expect(useTripStore.getState().isPanelOpen).toBe(true);
    });

    it('closes panel', () => {
      useTripStore.setState({ isPanelOpen: true });
      useTripStore.getState().setIsPanelOpen(false);
      expect(useTripStore.getState().isPanelOpen).toBe(false);
    });

    it('toggles panel open', () => {
      useTripStore.setState({ isPanelOpen: false });
      useTripStore.getState().togglePanel();
      expect(useTripStore.getState().isPanelOpen).toBe(true);
    });

    it('toggles panel closed', () => {
      useTripStore.setState({ isPanelOpen: true });
      useTripStore.getState().togglePanel();
      expect(useTripStore.getState().isPanelOpen).toBe(false);
    });
  });

  describe('clearTrip', () => {
    it('clears trips array', () => {
      useTripStore.setState({ trips: [mockTrip, mockTrip2] });
      useTripStore.getState().clearTrip();
      expect(useTripStore.getState().trips).toEqual([]);
    });

    it('resets selected trip index', () => {
      useTripStore.setState({ selectedTripIndex: 2 });
      useTripStore.getState().clearTrip();
      expect(useTripStore.getState().selectedTripIndex).toBe(0);
    });

    it('clears error', () => {
      useTripStore.setState({ error: 'Some error' });
      useTripStore.getState().clearTrip();
      expect(useTripStore.getState().error).toBeNull();
    });

    it('preserves station selections', () => {
      useTripStore.setState({
        originStationId: '127',
        destinationStationId: '635',
        trips: [mockTrip],
      });
      useTripStore.getState().clearTrip();
      expect(useTripStore.getState().originStationId).toBe('127');
      expect(useTripStore.getState().destinationStationId).toBe('635');
    });
  });

  describe('reset', () => {
    it('clears origin station', () => {
      useTripStore.setState({ originStationId: '127' });
      useTripStore.getState().reset();
      expect(useTripStore.getState().originStationId).toBeNull();
    });

    it('clears destination station', () => {
      useTripStore.setState({ destinationStationId: '635' });
      useTripStore.getState().reset();
      expect(useTripStore.getState().destinationStationId).toBeNull();
    });

    it('clears trips', () => {
      useTripStore.setState({ trips: [mockTrip] });
      useTripStore.getState().reset();
      expect(useTripStore.getState().trips).toEqual([]);
    });

    it('resets selected trip index', () => {
      useTripStore.setState({ selectedTripIndex: 2 });
      useTripStore.getState().reset();
      expect(useTripStore.getState().selectedTripIndex).toBe(0);
    });

    it('resets planning state', () => {
      useTripStore.setState({ isPlanning: true });
      useTripStore.getState().reset();
      expect(useTripStore.getState().isPlanning).toBe(false);
    });

    it('clears error', () => {
      useTripStore.setState({ error: 'Error' });
      useTripStore.getState().reset();
      expect(useTripStore.getState().error).toBeNull();
    });

    it('resets everything at once', () => {
      useTripStore.setState({
        originStationId: '127',
        destinationStationId: '635',
        trips: [mockTrip],
        selectedTripIndex: 1,
        isPlanning: true,
        error: 'Error',
      });
      useTripStore.getState().reset();

      const state = useTripStore.getState();
      expect(state.originStationId).toBeNull();
      expect(state.destinationStationId).toBeNull();
      expect(state.trips).toEqual([]);
      expect(state.selectedTripIndex).toBe(0);
      expect(state.isPlanning).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
