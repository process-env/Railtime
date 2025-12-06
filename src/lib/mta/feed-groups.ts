import type { FeedGroup } from '@/types/mta';
// Re-export getRouteColor from constants to maintain backwards compatibility
export { getRouteColor } from '@/lib/constants';

// Full feed group configuration with MTA API URLs
export const FEED_GROUPS: FeedGroup[] = [
  {
    id: 'ACE',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    routes: ['A', 'C', 'E'],
  },
  {
    id: 'BDFM',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    routes: ['B', 'D', 'F', 'M'],
  },
  {
    id: 'G',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    routes: ['G'],
  },
  {
    id: 'JZ',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    routes: ['J', 'Z'],
  },
  {
    id: 'NQRW',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    routes: ['N', 'Q', 'R', 'W'],
  },
  {
    id: 'L',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    routes: ['L'],
  },
  {
    id: 'SI',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',
    routes: ['SI', 'SIR'],
  },
  {
    id: '1234567',
    url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    routes: ['1', '2', '3', '4', '5', '6', '7', 'S'],
  },
];

export function getGroupUrl(groupId: string): string | null {
  const group = FEED_GROUPS.find(
    (g) => g.id.toLowerCase() === groupId.toLowerCase()
  );
  return group?.url || null;
}

export function getFeedGroupForRoute(routeId: string): string | null {
  const group = FEED_GROUPS.find((g) =>
    g.routes.some((r) => r.toLowerCase() === routeId.toLowerCase())
  );
  return group?.id || null;
}

export function listGroups(): string[] {
  return FEED_GROUPS.map((g) => g.id);
}
