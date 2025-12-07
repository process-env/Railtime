// POI (Point of Interest) types for TomTom Search API integration

export interface POI {
  id: string;
  name: string;
  category: string;
  categoryIcon: string;
  lat: number;
  lon: number;
  address: string;
  distance: number; // meters from station
  phone?: string;
  url?: string;
}

export interface POISearchResponse {
  pois: POI[];
  total: number;
}

// TomTom API response types
export interface TomTomPOIResult {
  id: string;
  poi: {
    name: string;
    categories: string[];
    phone?: string;
    url?: string;
  };
  address: {
    freeformAddress: string;
  };
  position: {
    lat: number;
    lon: number;
  };
  dist: number;
}

export interface TomTomSearchResponse {
  results: TomTomPOIResult[];
  summary: {
    totalResults: number;
    numResults: number;
  };
}

// Category mappings for icons and colors
export const POI_CATEGORIES: Record<string, { icon: string; color: string }> = {
  restaurant: { icon: '🍽️', color: '#EF4444' },
  'coffee shop': { icon: '☕', color: '#92400E' },
  cafe: { icon: '☕', color: '#92400E' },
  bank: { icon: '🏦', color: '#3B82F6' },
  atm: { icon: '💳', color: '#3B82F6' },
  pharmacy: { icon: '💊', color: '#10B981' },
  'convenience store': { icon: '🏪', color: '#F59E0B' },
  grocery: { icon: '🛒', color: '#22C55E' },
  bar: { icon: '🍺', color: '#A855F7' },
  default: { icon: '📍', color: '#6B7280' },
};
