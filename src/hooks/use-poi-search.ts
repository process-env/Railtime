import { useQuery } from '@tanstack/react-query';
import type { POI, POISearchResponse } from '@/types/poi';

interface UsePOISearchOptions {
  radius?: number;
  category?: string;
  limit?: number;
  enabled?: boolean;
}

interface UsePOISearchResult {
  pois: POI[];
  total: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

async function fetchNearbyPOIs(
  lat: number,
  lon: number,
  options: UsePOISearchOptions
): Promise<POISearchResponse> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    radius: (options.radius || 300).toString(),
    limit: (options.limit || 10).toString(),
  });

  if (options.category) {
    params.set('category', options.category);
  }

  const response = await fetch(`/api/v1/poi/nearby?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch POI data' }));
    throw new Error(error.error || 'Failed to fetch POI data');
  }

  return response.json();
}

export function usePOISearch(
  lat: number | undefined,
  lon: number | undefined,
  options: UsePOISearchOptions = {}
): UsePOISearchResult {
  const { radius = 300, category, limit = 10, enabled = true } = options;

  const query = useQuery({
    queryKey: ['poi', 'nearby', lat, lon, radius, category, limit],
    queryFn: () => fetchNearbyPOIs(lat!, lon!, { radius, category, limit }),
    enabled: enabled && lat !== undefined && lon !== undefined,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: 2,
    refetchOnWindowFocus: false,
  });

  return {
    pois: query.data?.pois || [],
    total: query.data?.total || 0,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
