'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, TrendingUp } from 'lucide-react';
import { getRouteColor } from '@/lib/constants';
import type { StationStats } from '@/lib/mta/load-stop-times';

interface BusiestStationsCardProps {
  stations: StationStats[];
}

export function BusiestStationsCard({ stations }: BusiestStationsCardProps) {
  // Calculate max for bar width
  const maxTrains = stations[0]?.dailyTrains || 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Busiest Stations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stations.slice(0, 10).map((station, index) => (
            <div key={station.stopId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-5">
                    {index + 1}.
                  </span>
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium truncate max-w-[180px]">
                    {station.stopName}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {station.dailyTrains.toLocaleString()} trains
                </span>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-2 ml-7">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${(station.dailyTrains / maxTrains) * 100}%`,
                    }}
                  />
                </div>

                {/* Route badges */}
                <div className="flex gap-0.5 flex-shrink-0">
                  {station.routes.slice(0, 5).map((routeId) => (
                    <div
                      key={routeId}
                      className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold"
                      style={{ backgroundColor: getRouteColor(routeId) }}
                    >
                      {routeId}
                    </div>
                  ))}
                  {station.routes.length > 5 && (
                    <Badge variant="outline" className="text-[8px] px-1 h-4">
                      +{station.routes.length - 5}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
