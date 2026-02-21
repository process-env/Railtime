'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { MapPin, RefreshCw, Navigation2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from '@/components/ui/sidebar';
import { useStaticData, useMultiStationArrivals } from '@/hooks';
import {
  useUserPosition,
  useGeolocationStatus,
  useGeolocationStore,
} from '@/stores';
import { findNearestStations } from '@/lib/geo/nearest-stations';
import { getRouteColor } from '@/lib/constants';
import { getTextColorForBackground } from '@/lib/mta/format';
import type { ArrivalItem } from '@/types/mta';

interface NearbyArrivalsWidgetProps {
  /** Whether sidebar is collapsed */
  isCollapsed?: boolean;
}

/**
 * Widget showing arrivals from nearby stations based on user location
 * Only visible on map page when user location is available
 */
export function NearbyArrivalsWidget({ isCollapsed }: NearbyArrivalsWidgetProps) {
  const { stations } = useStaticData();
  const userPosition = useUserPosition();
  const status = useGeolocationStatus();
  const requestLocation = useGeolocationStore((s) => s.requestLocation);

  // Find 2 nearest stations within 1.5km (~1 mile)
  const nearbyStations = useMemo(() => {
    if (!userPosition) return [];
    return findNearestStations(
      userPosition.lat,
      userPosition.lon,
      stations,
      2,
      1500 // 1.5km max distance
    );
  }, [userPosition, stations]);

  // Prepare station inputs for hook
  const stationInputs = useMemo(
    () =>
      nearbyStations.map((s) => ({
        id: s.id,
        name: s.enrichedName || s.name,
        distanceFormatted: s.distanceFormatted,
      })),
    [nearbyStations]
  );

  // Fetch arrivals for nearby stations
  const { stationArrivals, isLoading, refetchAll } = useMultiStationArrivals(
    stationInputs,
    {
      refreshInterval: 30000,
      maxArrivalsPerStation: 3,
      enabled: stationInputs.length > 0,
    }
  );

  // Don't show anything if collapsed
  if (isCollapsed) return null;

  // Show prompt to enable location
  if (status === 'idle' || status === 'denied' || status === 'error') {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            <span>Nearby Arrivals</span>
          </div>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 py-3 text-sm text-muted-foreground text-center">
            <p className="mb-2">Enable location to see arrivals from nearby stations</p>
            <Button
              variant="outline"
              size="sm"
              onClick={requestLocation}
              className="w-full"
            >
              <Navigation2 className="h-4 w-4 mr-2" />
              Enable Location
            </Button>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  // Show loading while requesting location
  if (status === 'requesting') {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            <span>Nearby Arrivals</span>
          </div>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  // No nearby stations found
  if (nearbyStations.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            <span>Nearby Arrivals</span>
          </div>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 py-3 text-sm text-muted-foreground text-center">
            No stations within 1 mile
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            <span>Nearby Arrivals</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={refetchAll}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="px-2 space-y-4">
          {stationArrivals.map((station) => (
            <StationArrivalsSection
              key={station.stationId}
              stationId={station.stationId}
              stationName={station.stationName}
              distance={station.distanceFormatted}
              arrivals={station.arrivals}
              isLoading={station.isLoading}
            />
          ))}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

interface StationArrivalsSectionProps {
  stationId: string;
  stationName: string;
  distance: string;
  arrivals: ArrivalItem[];
  isLoading: boolean;
}

function StationArrivalsSection({
  stationId,
  stationName,
  distance,
  arrivals,
  isLoading,
}: StationArrivalsSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Link
        href={`/stations/${stationId}`}
        className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-baseline gap-1.5"
      >
        <span className="truncate">{stationName}</span>
        <span className="text-[10px] opacity-70">({distance})</span>
      </Link>
      {arrivals.length === 0 ? (
        <p className="text-xs text-muted-foreground/70 pl-1">No arrivals</p>
      ) : (
        <div className="space-y-1">
          {arrivals.map((arrival) => (
            <CompactArrivalRow
              key={`${arrival.tripId}-${arrival.stopId}`}
              arrival={arrival}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompactArrivalRow({ arrival }: { arrival: ArrivalItem }) {
  const routeId = arrival.routeId || '?';
  const color = getRouteColor(routeId);
  const textColor = getTextColorForBackground(color);

  return (
    <div className="flex items-center justify-between py-1 px-1.5 rounded bg-muted/30">
      <div className="flex items-center gap-2">
        <Badge
          className="w-5 h-5 p-0 flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: color, color: textColor }}
        >
          {routeId}
        </Badge>
        <span className="text-xs truncate max-w-[100px]">
          {arrival.stopName || 'Unknown'}
        </span>
      </div>
      <span className="text-xs font-semibold tabular-nums">{arrival.in}</span>
    </div>
  );
}
