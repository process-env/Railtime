'use client';

import { create } from 'zustand';
import type { TrainPosition } from '@/types/mta';

/**
 * Trains Store
 *
 * Manages real-time train position data.
 * Note: Arrivals are now fetched via React Query (use-arrivals.ts),
 * not stored in Zustand.
 */
interface TrainsState {
  // Real-time train positions
  trains: Record<string, TrainPosition>; // keyed by tripId

  // Actions
  updateTrains: (trains: TrainPosition[]) => void;
  clearTrains: () => void;

  // Selectors
  getTrainsByRoute: (routeId: string) => TrainPosition[];
}

export const useTrainsStore = create<TrainsState>((set, get) => ({
  trains: {},

  updateTrains: (newTrains) =>
    set((state) => {
      const trains = { ...state.trains };
      for (const train of newTrains) {
        trains[train.tripId] = train;
      }
      return { trains };
    }),

  clearTrains: () => set({ trains: {} }),

  getTrainsByRoute: (routeId) => {
    const { trains } = get();
    const upperRoute = routeId.toUpperCase();
    return Object.values(trains).filter(
      (t) => t.routeId.toUpperCase() === upperRoute
    );
  },
}));
