'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sunrise, Sunset } from 'lucide-react';
import { getRouteColor } from '@/lib/constants';
import type { RouteScheduleStats } from '@/lib/mta/load-stop-times';

interface ServiceSpanCardProps {
  routeStats: RouteScheduleStats[];
  serviceDay: string;
}

export function ServiceSpanCard({ routeStats, serviceDay }: ServiceSpanCardProps) {
  // Get first/last train times for each route
  const routeSpans = routeStats.map((route) => {
    const allFirstTrains = route.directions.map((d) => d.firstTrain);
    const allLastTrains = route.directions.map((d) => d.lastTrain);

    // Find earliest first train and latest last train
    const earliest = allFirstTrains.sort()[0];
    const latest = allLastTrains.sort().reverse()[0];

    return {
      routeId: route.routeId,
      firstTrain: earliest,
      lastTrain: latest,
    };
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sunrise className="h-5 w-5" />
            Service Hours
          </CardTitle>
          <Badge variant="outline">{serviceDay}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {routeSpans.map((route) => (
            <div
              key={route.routeId}
              className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: getRouteColor(route.routeId) }}
              >
                {route.routeId}
              </div>
              <div className="text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Sunrise className="h-3 w-3" />
                  {route.firstTrain}
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Sunset className="h-3 w-3" />
                  {route.lastTrain}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
