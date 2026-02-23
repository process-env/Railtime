'use client';

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StationCard } from '@/components/stations';
import { useStaticData, useTrainPositions } from '@/hooks';
import { useAlertsData } from '@/components/providers/AlertsProvider';
import { isParentStation } from '@/lib/mta/station-utils';

export default function StationsPage() {
  const [search, setSearch] = useState('');
  const { stations, isLoading } = useStaticData();
  const { trains } = useTrainPositions({ refreshInterval: 15000 });
  const { alerts } = useAlertsData();

  // Build lookup maps for derived data
  const stationData = useMemo(() => {
    // Time thresholds for train states (matching map behavior)
    const AT_STATION_THRESHOLD_MS = 30 * 1000; // 30 seconds - at station
    const ARRIVING_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes - arriving
    const EN_ROUTE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - en route
    // eslint-disable-next-line react-hooks/purity
    const currentTime = Date.now();

    const stationTrainStates: Record<string, { atStation: number; arriving: number; enRoute: number }> = {};

    for (const train of trains) {
      if (train.eta) {
        const etaTime = new Date(train.eta).getTime();
        const timeUntilArrival = etaTime - currentTime;

        // Only count if arriving within threshold and not too far in the past
        if (timeUntilArrival > -AT_STATION_THRESHOLD_MS && timeUntilArrival <= EN_ROUTE_THRESHOLD_MS) {
          const stopId = train.nextStopId;
          const parentId = stopId?.replace(/[NS]$/, '');
          if (parentId) {
            if (!stationTrainStates[parentId]) {
              stationTrainStates[parentId] = { atStation: 0, arriving: 0, enRoute: 0 };
            }

            if (timeUntilArrival <= AT_STATION_THRESHOLD_MS) {
              stationTrainStates[parentId].atStation++;
            } else if (timeUntilArrival <= ARRIVING_THRESHOLD_MS) {
              stationTrainStates[parentId].arriving++;
            } else {
              stationTrainStates[parentId].enRoute++;
            }
          }
        }
      }
    }

    // Build set of stations with alerts
    const stationsWithAlerts = new Set<string>();
    for (const alert of alerts) {
      for (const stopId of (alert.affectedStops ?? [])) {
        const parentId = stopId?.replace(/[NS]$/, '');
        if (parentId) stationsWithAlerts.add(parentId);
      }
    }

    return { stationTrainStates, stationsWithAlerts };
  }, [trains, alerts]);

  // Filter to parent stations only and apply search
  const filteredStations = useMemo(() => {
    const stationList = Object.values(stations).filter(isParentStation);

    if (!search.trim()) return stationList;

    const query = search.toLowerCase();
    return stationList.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.enrichedName?.toLowerCase().includes(query) ||
        s.routes?.toLowerCase().includes(query)
    );
  }, [stations, search]);

  return (
    <div className="p-6 space-y-6 overflow-y-auto overflow-x-hidden h-full w-full">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Stations</h1>
        <p className="text-muted-foreground">
          Browse all{' '}
          {Object.keys(stations).length > 0 ? filteredStations.length : '—'} NYC
          subway stations
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search stations or routes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Station List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="h-[100px]" />
          ))}
        </div>
      ) : filteredStations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No stations found</p>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-primary mt-2 hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
          {filteredStations.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              trainStates={stationData.stationTrainStates[station.id]}
              hasAlerts={stationData.stationsWithAlerts.has(station.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
