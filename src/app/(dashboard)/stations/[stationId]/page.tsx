'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, RefreshCw, ExternalLink, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrivalBoard } from '@/components/stations';
import { POIList } from '@/components/poi';
import { useStaticData } from '@/hooks';
import { useArrivals } from '@/hooks/use-arrivals';
import { useUIStore } from '@/stores';
import { getRouteColor } from '@/lib/constants';
import { getFeedGroupForRoute } from '@/lib/mta/feed-groups';

export default function StationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const stationId = params.stationId as string;

  const { stations, isLoading: stationsLoading } = useStaticData();
  const { setSelectedStation } = useUIStore();

  const station = stations[stationId];
  const routes = station?.routes?.split(/[,\s]+/).filter(Boolean) || [];

  // Derive feed group from the station's first route
  const feedGroup = useMemo(() => {
    if (routes.length === 0) return '';
    return getFeedGroupForRoute(routes[0]) ?? '';
  }, [routes]);

  // Use the shared arrivals hook (handles polling, socket, and fallback)
  const {
    arrivals: arrivalBoard,
    isLoading: arrivalsLoading,
    error,
    refetch,
  } = useArrivals(feedGroup, stationId, { enabled: !!station && !!feedGroup });

  const arrivals = arrivalBoard?.arrivals ?? [];

  // Show on map
  const handleShowOnMap = () => {
    setSelectedStation(stationId);
    router.push('/map');
  };

  if (stationsLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!station) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">Station not found</p>
          <Button asChild variant="outline">
            <Link href="/stations">Back to stations</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
            <Link href="/stations">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to stations
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">
            {station.enrichedName || station.name}
          </h1>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>
              {station.lat.toFixed(6)}, {station.lon.toFixed(6)}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleShowOnMap}>
          <ExternalLink className="h-4 w-4 mr-2" />
          View on map
        </Button>
      </div>

      {/* Route badges */}
      <div className="flex flex-wrap gap-2">
        {routes.map((route) => (
          <Badge
            key={route}
            className="w-10 h-10 p-0 flex items-center justify-center text-lg font-bold"
            style={{
              backgroundColor: getRouteColor(route),
              color: getRouteColor(route) === '#FCCC0A' ? '#000' : '#fff',
            }}
          >
            {route}
          </Badge>
        ))}
      </div>

      {/* Arrivals Board */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Upcoming Arrivals</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={arrivalsLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${arrivalsLoading ? 'animate-spin' : ''}`}
            />
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-4 text-destructive">
              <p>{error}</p>
            </div>
          ) : (
            <ArrivalBoard arrivals={arrivals} loading={arrivalsLoading} />
          )}
        </CardContent>
      </Card>

      {/* Nearby Places */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Nearby
          </CardTitle>
        </CardHeader>
        <CardContent>
          <POIList lat={station.lat} lon={station.lon} radius={300} />
        </CardContent>
      </Card>
    </div>
  );
}
