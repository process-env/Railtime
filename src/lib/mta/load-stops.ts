import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import type { Stop } from '@/types/mta';
import { isParentStation } from './station-utils';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const STOPS_CSV = path.join(DATA_DIR, 'stops.txt');

// Cache
let stopsCache: {
  dict: Record<string, Stop>;
  parentNames: Record<string, string>;
  parentOf: Record<string, string>;
  list: Stop[];
} | null = null;

export async function loadStops(): Promise<{
  dict: Record<string, Stop>;
  parentNames: Record<string, string>;
  parentOf: Record<string, string>;
  list: Stop[];
}> {
  if (stopsCache) return stopsCache;

  const text = await fs.readFile(STOPS_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const dict: Record<string, Stop> = {};
  const parentNames: Record<string, string> = {};
  const parentOf: Record<string, string> = {};
  const list: Stop[] = [];

  for (const r of rows as Record<string, string>[]) {
    const stop: Stop = {
      id: r.stop_id,
      name: r.stop_name,
      lat: Number(r.stop_lat),
      lon: Number(r.stop_lon),
      routes: r.routes || null,
      parent: r.parent_station || null,
    };

    dict[r.stop_id] = stop;
    list.push(stop);

    if (r.parent_station && !parentNames[r.parent_station]) {
      parentNames[r.parent_station] = r.stop_name;
    }
    if (r.parent_station) {
      parentOf[r.stop_id] = r.parent_station;
    }
  }

  stopsCache = { dict, parentNames, parentOf, list };
  return stopsCache;
}

export async function getStop(stopId: string): Promise<Stop | null> {
  const { dict } = await loadStops();
  return dict[stopId] || null;
}

export async function searchStops(
  query?: string,
  routeFilter?: string,
  limit = 2000
): Promise<Stop[]> {
  const { list } = await loadStops();

  let filtered = list;

  // Filter by query
  if (query) {
    const lowerQuery = query.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.id.toLowerCase().includes(lowerQuery)
    );
  }

  // Filter by route
  if (routeFilter) {
    const upperRoute = routeFilter.toUpperCase();
    filtered = filtered.filter((s) => {
      if (!s.routes) return false;
      const routes = s.routes.split(/[,\s]+/).map((r) => r.toUpperCase());
      return routes.includes(upperRoute);
    });
  }

  return filtered.slice(0, limit);
}

export async function getParentStations(): Promise<Stop[]> {
  const { list } = await loadStops();
  return list.filter(isParentStation);
}

// Clear cache (useful for testing)
export function clearStopsCache(): void {
  stopsCache = null;
}
