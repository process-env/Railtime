'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Train, AlertTriangle } from 'lucide-react';
import { getRouteColor } from '@/lib/constants';
import type { Station } from '@/types/mta';

interface TrainStates {
  atStation: number;
  arriving: number;
  enRoute: number;
}

interface StationCardProps {
  station: Station;
  trainStates?: TrainStates;
  hasAlerts?: boolean;
}

// Get the best location name for display
function getLocationName(station: Station): string {
  const { crossStreet, name: originalName } = station;

  // If we have cross street data, use it
  if (crossStreet) {
    // Take only the first cross street (before any comma)
    const firstCrossStreet = crossStreet.split(',')[0].trim();

    // Skip if it's just repeating the street name (e.g., "West 237th Street" for "238 St")
    if (firstCrossStreet.toLowerCase().includes('street') &&
        firstCrossStreet.match(/\d+/) &&
        originalName.match(/\d+/)) {
      const enrichedNum = firstCrossStreet.match(/\d+/)?.[0];
      const originalNum = originalName.match(/\d+/)?.[0];
      if (enrichedNum && originalNum && Math.abs(parseInt(enrichedNum) - parseInt(originalNum)) <= 2) {
        // Try second cross street if available
        const parts = crossStreet.split(',');
        if (parts.length > 1) {
          return parts[1].trim();
        }
        // Fall through to use station name
      } else {
        return firstCrossStreet;
      }
    } else {
      return firstCrossStreet;
    }
  }

  // Fallback: use station name as the location (not lat/long)
  return originalName;
}

export function StationCard({ station, trainStates, hasAlerts = false }: StationCardProps) {
  const router = useRouter();
  const routes = station.routes?.split(/[,\s]+/).filter(Boolean) || [];
  const locationName = getLocationName(station);

  const handleMapClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/map?lat=${station.lat}&lon=${station.lon}&zoom=16`);
  };

  return (
    <Link href={`/stations/${station.id}`}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
        <CardContent className="p-4 h-full">
          <div className="flex items-start justify-between gap-3 h-full">
            <div className="flex flex-col justify-between min-h-[72px] flex-1">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium leading-tight">{station.name}</h3>
                  {hasAlerts && (
                    <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={handleMapClick}
                    onKeyDown={(e) => e.key === 'Enter' && handleMapClick(e as unknown as React.MouseEvent)}
                    className="hover:text-primary hover:underline transition-colors line-clamp-1 cursor-pointer"
                  >
                    {locationName}
                  </span>
                </div>
              </div>
              {trainStates && (trainStates.atStation > 0 || trainStates.arriving > 0 || trainStates.enRoute > 0) && (
                <div className="flex items-center gap-2 text-xs mt-2">
                  <Train className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    {trainStates.atStation > 0 && (
                      <span className="font-medium text-amber-500">{trainStates.atStation} at station</span>
                    )}
                    {trainStates.arriving > 0 && (
                      <span className="font-medium text-green-500">{trainStates.arriving} arriving</span>
                    )}
                    {trainStates.enRoute > 0 && (
                      <span className="font-medium text-blue-400">{trainStates.enRoute} en route</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[100px]">
              {routes.slice(0, 6).map((route) => (
                <Badge
                  key={route}
                  className="w-6 h-6 p-0 flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: getRouteColor(route),
                    color: getRouteColor(route) === '#FCCC0A' ? '#000' : '#fff',
                  }}
                >
                  {route}
                </Badge>
              ))}
              {routes.length > 6 && (
                <Badge variant="secondary" className="text-xs">
                  +{routes.length - 6}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
