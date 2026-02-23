'use client';

import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTripStore, useSelectedTrip, useCanPlanTrip } from '@/stores/trip-store';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { TripPlan } from '@/lib/trip-planner/types';

interface UseTripPlannerOptions {
  alternatives?: number;
  maxTransfers?: number;
  avoidRoutes?: string[];
}

interface UseTripPlannerReturn {
  // Station selection
  originStationId: string | null;
  destinationStationId: string | null;
  setOrigin: (stationId: string | null) => void;
  setDestination: (stationId: string | null) => void;
  swapStations: () => void;

  // Trip planning
  planTrip: (options?: UseTripPlannerOptions) => void;
  canPlan: boolean;
  isPlanning: boolean;

  // Results
  trips: TripPlan[];
  selectedTrip: TripPlan | null;
  selectedTripIndex: number;
  selectTrip: (index: number) => void;

  // Status
  error: string | null;
  clearTrip: () => void;
  reset: () => void;
}

/**
 * Hook for trip planning functionality
 *
 * Uses TanStack Query's useMutation for the trip planning API call,
 * with Zustand store for state management.
 *
 * @example
 * ```tsx
 * const { setOrigin, setDestination, planTrip, trips, selectedTrip } = useTripPlanner();
 *
 * // Set stations
 * setOrigin('127'); // Times Square
 * setDestination('635'); // Union Square
 *
 * // Plan trip
 * planTrip();
 *
 * // Show results
 * console.log(trips); // Array of trip options
 * console.log(selectedTrip); // Currently selected trip
 * ```
 */
export function useTripPlanner(): UseTripPlannerReturn {
  const originStationId = useTripStore((s) => s.originStationId);
  const destinationStationId = useTripStore((s) => s.destinationStationId);
  const setOrigin = useTripStore((s) => s.setOrigin);
  const setDestination = useTripStore((s) => s.setDestination);
  const swapStations = useTripStore((s) => s.swapStations);

  const trips = useTripStore((s) => s.trips);
  const selectedTripIndex = useTripStore((s) => s.selectedTripIndex);
  const setTrips = useTripStore((s) => s.setTrips);
  const selectTrip = useTripStore((s) => s.selectTrip);

  const isPlanning = useTripStore((s) => s.isPlanning);
  const setIsPlanning = useTripStore((s) => s.setIsPlanning);
  const error = useTripStore((s) => s.error);
  const setError = useTripStore((s) => s.setError);
  const clearTrip = useTripStore((s) => s.clearTrip);
  const reset = useTripStore((s) => s.reset);

  const selectedTrip = useSelectedTrip();
  const canPlan = useCanPlanTrip();

  const mutation = useMutation({
    mutationKey: queryKeys.tripPlan,
    mutationFn: mtaApi.planTrip,
    onMutate: () => {
      setIsPlanning(true);
      setError(null);
    },
    onSuccess: (data) => {
      setTrips(data.trips);
    },
    onError: (err: Error) => {
      const message = err instanceof Error ? err.message : 'Failed to plan trip';
      setError(message);
      setTrips([]);
    },
    onSettled: () => {
      setIsPlanning(false);
    },
  });

  const planTrip = useCallback(
    (options?: UseTripPlannerOptions) => {
      if (!originStationId || !destinationStationId) {
        setError('Please select both origin and destination stations');
        return;
      }

      mutation.mutate({
        origin: originStationId,
        destination: destinationStationId,
        alternatives: options?.alternatives ?? 3,
        maxTransfers: options?.maxTransfers,
        avoidRoutes: options?.avoidRoutes,
      });
    },
    [originStationId, destinationStationId, mutation, setError]
  );

  return {
    // Station selection
    originStationId,
    destinationStationId,
    setOrigin,
    setDestination,
    swapStations,

    // Trip planning
    planTrip,
    canPlan,
    isPlanning,

    // Results
    trips,
    selectedTrip,
    selectedTripIndex,
    selectTrip,

    // Status
    error,
    clearTrip,
    reset,
  };
}

/**
 * Format duration in minutes
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

/**
 * Get a short summary of a trip
 */
export function getTripSummaryText(trip: TripPlan): string {
  const duration = formatDuration(trip.totalDurationSeconds);
  const routes = trip.routes.join(', ');
  const transfers =
    trip.totalTransfers === 0
      ? 'Direct'
      : trip.totalTransfers === 1
      ? '1 transfer'
      : `${trip.totalTransfers} transfers`;

  return `${duration} via ${routes} (${transfers})`;
}
