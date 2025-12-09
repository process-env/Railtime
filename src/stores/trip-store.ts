'use client';

import { create } from 'zustand';
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
    }),
}));

/**
 * Get the currently selected trip plan
 */
export function useSelectedTrip(): TripPlan | null {
  const trips = useTripStore((state) => state.trips);
  const selectedTripIndex = useTripStore((state) => state.selectedTripIndex);
  return trips[selectedTripIndex] ?? null;
}

/**
 * Check if we have valid origin and destination for planning
 */
export function useCanPlanTrip(): boolean {
  const originStationId = useTripStore((state) => state.originStationId);
  const destinationStationId = useTripStore((state) => state.destinationStationId);
  const isPlanning = useTripStore((state) => state.isPlanning);
  return Boolean(originStationId && destinationStationId && !isPlanning);
}
