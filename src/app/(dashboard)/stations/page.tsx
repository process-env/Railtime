'use client';

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StationCard } from '@/components/stations';
import { useStaticData, useTrainPositions, useAlerts } from '@/hooks';
import { isParentStation } from '@/lib/mta/station-utils';

export default function StationsPage() {
  const [search, setSearch] = useState('');
  const { stations, isLoading } = useStaticData();
  const { trains } = useTrainPositions({ refreshInterval: 15000 });
  const { alerts } = useAlerts();

  // Build lookup maps for derived data
  const stationData = useMemo(() => {
    // Count trains approaching each station within 5 minutes
    const APPROACHING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    const trainsPerStation: Record<string, number> = {};
    for (const train of trains) {
      // Check if train is arriving soon (within threshold)
      if (train.eta) {
        const etaTime = new Date(train.eta).getTime();
        const timeUntilArrival = etaTime - now;

        // Only count if arriving within threshold and not in the past
        if (timeUntilArrival > 0 && timeUntilArrival <= APPROACHING_THRESHOLD_MS) {
          const stopId = train.nextStopId;
          const parentId = stopId?.replace(/[NS]$/, '');
          if (parentId) {
            trainsPerStation[parentId] = (trainsPerStation[parentId] || 0) + 1;
          }
        }
      }
    }

    // Build set of stations with alerts
    const stationsWithAlerts = new Set<string>();
    for (const alert of alerts) {
      for (const stopId of alert.affectedStops) {
        const parentId = stopId?.replace(/[NS]$/, '');
        if (parentId) stationsWithAlerts.add(parentId);
      }
    }

    return { trainsPerStation, stationsWithAlerts };
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
              trainsApproaching={stationData.trainsPerStation[station.id] || 0}
              hasAlerts={stationData.stationsWithAlerts.has(station.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
