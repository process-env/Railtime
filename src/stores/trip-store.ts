'use client';

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { TripPlan } from '@/lib/trip-planner/types';

interface TripState {
  // Station selection
  originStationId: string | null;
  destinationStationId: string | null;
  setOrigin: (stationId: string | null) => void;
  setDestination: (stationId: string | null) => void;
  swapStations: () => void;

  // Trip results
  trips: TripPlan[];
  selectedTripIndex: number;
  setTrips: (trips: TripPlan[]) => void;
  selectTrip: (index: number) => void;

  // UI state
  isPlanning: boolean;
  setIsPlanning: (planning: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  isPanelOpen: boolean;
  setIsPanelOpen: (open: boolean) => void;
  togglePanel: () => void;

  // Clear
  clearTrip: () => void;
  reset: () => void;
}

export const useTripStore = create<TripState>()((set) => ({
  // Station selection
  originStationId: null,
  destinationStationId: null,
  setOrigin: (originStationId) =>
    set({ originStationId, trips: [], error: null }),
  setDestination: (destinationStationId) =>
    set({ destinationStationId, trips: [], error: null }),
  swapStations: () =>
    set((state) => ({
      originStationId: state.destinationStationId,
      destinationStationId: state.originStationId,
      trips: [],
      error: null,
    })),

  // Trip results
  trips: [],
  selectedTripIndex: 0,
  setTrips: (trips) => set({ trips, selectedTripIndex: 0, error: null }),
  selectTrip: (selectedTripIndex) => set({ selectedTripIndex }),

  // UI state
  isPlanning: false,
  setIsPlanning: (isPlanning) => set({ isPlanning }),
  error: null,
  setError: (error) => set({ error }),
  isPanelOpen: false,
  setIsPanelOpen: (isPanelOpen) => set({ isPanelOpen }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

  // Clear
  clearTrip: () =>
    set({
      trips: [],
      selectedTripIndex: 0,
      error: null,
    }),
  reset: () =>
    set({
      originStationId: null,
      destinationStationId: null,
      trips: [],
      selectedTripIndex: 0,
      isPlanning: false,
      error: null,
      isPanelOpen: false,
    }),
}));

/**
 * Get the currently selected trip plan.
 * Uses useShallow to subscribe to { trips, selectedTripIndex } as a single
 * shallow-compared selector instead of two independent subscriptions.
 */
export function useSelectedTrip(): TripPlan | null {
  const { trips, selectedTripIndex } = useTripStore(
    useShallow((state) => ({
      trips: state.trips,
      selectedTripIndex: state.selectedTripIndex,
    }))
  );
  return trips[selectedTripIndex] ?? null;
}

/**
 * Check if we have valid origin and destination for planning.
 * Uses useShallow to subscribe to the three related fields in a single
 * selector instead of three independent subscriptions.
 */
export function useCanPlanTrip(): boolean {
  const { originStationId, destinationStationId, isPlanning } = useTripStore(
    useShallow((state) => ({
      originStationId: state.originStationId,
      destinationStationId: state.destinationStationId,
      isPlanning: state.isPlanning,
    }))
  );
  return Boolean(originStationId && destinationStationId && !isPlanning);
}
