'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Train } from 'lucide-react';
import { getRouteColor } from '@/lib/constants';
import type { RouteScheduleStats } from '@/lib/mta/load-stop-times';

interface ScheduleFrequencyCardProps {
  routeStats: RouteScheduleStats[];
  serviceDay: string;
}

export function ScheduleFrequencyCard({ routeStats, serviceDay }: ScheduleFrequencyCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Service Frequency
          </CardTitle>
          <Badge variant="outline">{serviceDay}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
          {routeStats.map((route) => (
            <div
              key={route.routeId}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {/* Route badge */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: getRouteColor(route.routeId) }}
              >
                {route.routeId}
              </div>

              {/* Directions */}
              <div className="flex-1 space-y-1.5">
                {route.directions.map((dir) => (
                  <div
                    key={`${route.routeId}-${dir.directionId}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Train className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground truncate max-w-[140px]">
                        {dir.headsign}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-medium">
                        Every {dir.avgHeadwayMinutes || '—'} min
                      </span>
                      <span className="text-muted-foreground">
                        {dir.tripsPerDay} trips
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
