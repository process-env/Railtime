'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Train, Clock, MapPin, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { getRouteColor, ALL_ROUTES } from '@/lib/constants';
import type { RouteScheduleStats } from '@/lib/mta/load-stop-times';

interface RouteProfileCardProps {
  routeStats: RouteScheduleStats[];
  activeTrains?: Record<string, number>; // routeId -> count
}

export function RouteProfileCard({ routeStats, activeTrains = {} }: RouteProfileCardProps) {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const selectedStats = routeStats.find((r) => r.routeId === selectedRoute);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Train className="h-5 w-5" />
            Route Profile
          </CardTitle>
          <Select value={selectedRoute || ''} onValueChange={setSelectedRoute}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select route" />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROUTES.filter((r) => routeStats.some((rs) => rs.routeId === r)).map(
                (routeId) => (
                  <SelectItem key={routeId} value={routeId}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: getRouteColor(routeId) }}
                      >
                        {routeId}
                      </div>
                      <span>{routeId} Train</span>
                    </div>
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!selectedRoute ? (
          <div className="text-center py-8 text-muted-foreground">
            Select a route to view details
          </div>
        ) : !selectedStats ? (
          <div className="text-center py-8 text-muted-foreground">
            No schedule data available for this route
          </div>
        ) : (
          <div className="space-y-4">
            {/* Route header */}
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold"
                style={{ backgroundColor: getRouteColor(selectedRoute) }}
              >
                {selectedRoute}
              </div>
              <div>
                <div className="text-lg font-semibold">{selectedRoute} Train</div>
                <div className="text-sm text-muted-foreground">
                  {activeTrains[selectedRoute] || 0} trains active now
                </div>
              </div>
            </div>

            {/* Direction details */}
            <div className="space-y-3">
              {selectedStats.directions.map((dir) => (
                <div
                  key={`${selectedRoute}-${dir.directionId}`}
                  className="p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowRight
                      className={`h-4 w-4 ${
                        dir.directionId === '0' ? 'rotate-0' : 'rotate-180'
                      }`}
                    />
                    <span className="font-medium">{dir.headsign}</span>
                    <Badge variant="outline" className="ml-auto">
                      {dir.tripsPerDay} trips/day
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Every {dir.avgHeadwayMinutes || '—'} min</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Train className="h-3.5 w-3.5" />
                      <span>{dir.avgDurationMinutes} min trip</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>{dir.stopCount} stops</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {dir.firstTrain} – {dir.lastTrain}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Expand/collapse for more details */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show more
                </>
              )}
            </Button>

            {expanded && (
              <div className="pt-2 border-t space-y-2 text-sm text-muted-foreground">
                <div>
                  Total daily trips:{' '}
                  <span className="font-medium text-foreground">
                    {selectedStats.directions.reduce(
                      (sum, d) => sum + d.tripsPerDay,
                      0
                    )}
                  </span>
                </div>
                <div>
                  Terminals:{' '}
                  <span className="font-medium text-foreground">
                    {selectedStats.directions.map((d) => d.headsign).join(' ↔ ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
