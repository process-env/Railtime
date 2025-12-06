import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import type { Route } from '@/types/mta';
import { getFeedGroupForRoute } from './feed-groups';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const ROUTES_CSV = path.join(DATA_DIR, 'routes.txt');

// Cache
let routesCache: { list: Route[]; dict: Record<string, Route> } | null = null;

export async function loadRoutes(): Promise<{
  list: Route[];
  dict: Record<string, Route>;
}> {
  if (routesCache) return routesCache;

  const text = await fs.readFile(ROUTES_CSV, 'utf8');
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const list: Route[] = (rows as Record<string, string>[]).map(
    (r): Route => ({
      route_id: r.route_id,
      short_name: r.route_short_name,
      long_name: r.route_long_name,
      desc: r.route_desc || null,
      type: r.route_type,
      color: r.route_color || null,
      text_color: r.route_text_color || null,
    })
  );

  const dict = Object.fromEntries(list.map((r) => [r.route_id, r]));

  routesCache = { list, dict };
  return routesCache;
}

export async function getRouteWithFeedGroup(routeId: string): Promise<
  | (Route & { feedGroupId: string | null })
  | null
> {
  const { dict } = await loadRoutes();
  const route = dict[routeId];
  if (!route) return null;

  return {
    ...route,
    feedGroupId: getFeedGroupForRoute(routeId),
  };
}

// Clear cache (useful for testing)
export function clearRoutesCache(): void {
  routesCache = null;
}
