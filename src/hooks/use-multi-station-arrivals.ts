'use client';

import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import type { ArrivalItem } from '@/types/mta';

interface StationArrivals {
  stationId: string;
  stationName: string;
  distanceFormatted: string;
  arrivals: ArrivalItem[];
  isLoading: boolean;
  error: string | null;
}

interface UseMultiStationArrivalsOptions {
  /** Refresh interval in ms (default: 30000) */
  refreshInterval?: number;
  /** Maximum arrivals per station (default: 5) */
  maxArrivalsPerStation?: number;
  /** Whether queries are enabled (default: true) */
  enabled?: boolean;
}

interface StationInput {
  id: string;
  name: string;
  distanceFormatted: string;
}

/**
 * Fetch arrivals for multiple stations in parallel using React Query
 */
export function useMultiStationArrivals(
  stations: StationInput[],
  options: UseMultiStationArrivalsOptions = {}
) {
  const {
    refreshInterval = 30000,
    maxArrivalsPerStation = 5,
    enabled = true,
  } = options;

  const queries = useQueries({
    queries: stations.map((station) => ({
      queryKey: queryKeys.multiArrivals(station.id),
      queryFn: async (): Promise<{ arrivals: ArrivalItem[] }> => {
        const res = await fetch(`/api/v1/arrivals/station/${station.id}`);
        if (!res.ok) throw new Error('Failed to fetch arrivals');
        return res.json();
      },
      enabled: enabled && !!station.id,
      refetchInterval: enabled ? refreshInterval : false,
      staleTime: refreshInterval / 2,
    })),
  });

  // Map queries to station arrivals
  const stationArrivals: StationArrivals[] = stations.map((station, index) => {
    const query = queries[index];
    const arrivals = query.data?.arrivals || [];

    return {
      stationId: station.id,
      stationName: station.name,
      distanceFormatted: station.distanceFormatted,
      arrivals: arrivals.slice(0, maxArrivalsPerStation),
      isLoading: query.isLoading,
      error: query.error?.message || null,
    };
  });

  // Overall loading state
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  // Refetch all stations
  const refetchAll = () => {
    queries.forEach((q) => q.refetch());
  };

  return {
    stationArrivals,
    isLoading,
    isError,
    refetchAll,
  };
}
