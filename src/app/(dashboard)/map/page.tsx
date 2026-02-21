'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary, MapErrorFallback } from '@/components/ErrorBoundary';
import { useUIStore } from '@/stores';
import { useTrainPositions, useAlerts } from '@/hooks';

// Dynamic import to avoid SSR issues with MapLibre
const SubwayMap = dynamic(
  () => import('@/components/map/SubwayMap').then((mod) => mod.SubwayMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <div className="text-center space-y-4">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    ),
  }
);

// Preload duration matrix immediately — runs in parallel with SubwayMap chunk download.
// buildRouteDurationMatrix dedupes internally, so SubwayMap gets the same promise.
import('@/lib/map/route-durations').then(({ buildRouteDurationMatrix }) =>
  buildRouteDurationMatrix()
);

export default function MapPage() {
  const searchParams = useSearchParams();
  const { setMapView } = useUIStore();

  // Start data fetches immediately — runs in parallel with SubwayMap chunk download
  const { trains } = useTrainPositions({ refreshInterval: 15000 });
  const { alerts } = useAlerts();

  // Handle URL params for map navigation (from station cards)
  useEffect(() => {
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const zoom = searchParams.get('zoom');

    if (lat && lon) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      const zoomNum = zoom ? parseFloat(zoom) : 15;

      if (!isNaN(latNum) && !isNaN(lonNum)) {
        setMapView([lonNum, latNum], zoomNum);
      }
    }
  }, [searchParams, setMapView]);

  return (
    <div className="h-full w-full overflow-hidden">
      <ErrorBoundary fallback={<MapErrorFallback onRetry={() => window.location.reload()} />}>
        <SubwayMap trains={trains} alerts={alerts} />
      </ErrorBoundary>
    </div>
  );
}
