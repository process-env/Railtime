'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { mtaApi } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Stop, Route } from '@/types/mta';

interface StaticData {
  stations: Record<string, Stop>;
  routes: Record<string, Route>;
  parentStations: string[];
  isLoading: boolean;
  error: string | null;
}

export function useStaticData(): StaticData {
  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.stops,
        queryFn: mtaApi.getStops,
        staleTime: Infinity, // Never stale - static data
        gcTime: Infinity,
      },
      {
        queryKey: queryKeys.routes,
        queryFn: mtaApi.getRoutes,
        staleTime: Infinity,
        gcTime: Infinity,
      },
      {
        queryKey: queryKeys.enrichedStations,
        queryFn: mtaApi.getEnrichedStations,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    ],
  });

  const [stopsQuery, routesQuery, enrichedQuery] = results;

  // Transform data (same logic as stations-store)
  const data = useMemo(() => {
    const stops: Stop[] = stopsQuery.data || [];
    const routes: Route[] = routesQuery.data || [];
    const enrichedData = enrichedQuery.data || {};

    const stationsDict: Record<string, Stop> = {};
    const parentIds: string[] = [];

    for (const stop of stops) {
      const enrichment = enrichedData[stop.id];
      stationsDict[stop.id] = {
        ...stop,
        enrichedName: enrichment?.enrichedName,
        crossStreet: enrichment?.crossStreet,
      };
      if (!stop.parent && /^\d+$/.test(stop.id)) {
        parentIds.push(stop.id);
      }
    }

    const routesDict = Object.fromEntries(routes.map((r) => [r.route_id, r]));

    return {
      stations: stationsDict,
      routes: routesDict,
      parentStations: parentIds,
    };
  }, [stopsQuery.data, routesQuery.data, enrichedQuery.data]);

  const isLoading = results.some((q) => q.isLoading);
  const error = results.find((q) => q.error)?.error;

  return {
    ...data,
    isLoading,
    error: error instanceof Error ? error.message : null,
  };
}

// Selector hooks for specific needs
export function useStationsByRoute(routeId: string): Stop[] {
  const { stations } = useStaticData();
  const upperRoute = routeId.toUpperCase();

  return useMemo(() => {
    return Object.values(stations).filter((s) => {
      if (!s.routes) return false;
      const routes = s.routes.split(/[,\s]+/).map((r) => r.toUpperCase());
      return routes.includes(upperRoute);
    });
  }, [stations, upperRoute]);
}

export function useSearchStations(query: string): Stop[] {
  const { stations, parentStations } = useStaticData();
  const lowerQuery = query.toLowerCase();

  return useMemo(() => {
    if (!lowerQuery) return [];
    return parentStations
      .map((id) => stations[id])
      .filter(
        (s) =>
          s &&
          (s.name.toLowerCase().includes(lowerQuery) ||
            s.enrichedName?.toLowerCase().includes(lowerQuery))
      )
      .slice(0, 20);
  }, [stations, parentStations, lowerQuery]);
}
