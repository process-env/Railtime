export const queryKeys = {
  // Static data (long cache)
  stops: ['stops'] as const,
  routes: ['routes'] as const,
  enrichedStations: ['enriched-stations'] as const,
  staticData: ['static-data'] as const,

  // Real-time data (short cache with polling)
  trains: ['trains'] as const,
  alerts: (routeIds?: string[]) => ['alerts', routeIds] as const,
  arrivals: (groupId: string, stopId: string) =>
    ['arrivals', groupId, stopId] as const,

  // Analytics
  feedStatus: (groupId: string) => ['feed-status', groupId] as const,
  allFeedStatus: ['feed-status'] as const,
  historical: (hours: number) => ['historical', hours] as const,
  analytics: ['analytics'] as const,

  // Schedule (GTFS static - very long cache)
  schedule: ['schedule'] as const,
  routeSchedule: (routeId: string) => ['schedule', routeId] as const,

  // Equipment (Elevator & Escalator)
  equipment: ['equipment'] as const,
};
