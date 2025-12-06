'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUp, ArrowDown, Clock } from 'lucide-react';
import { getRouteColor } from '@/lib/constants';
import { getDirectionFromStopId, getTextColorForBackground } from '@/lib/mta/format';
import type { ArrivalItem } from '@/types/mta';

interface ArrivalBoardProps {
  arrivals: ArrivalItem[];
  loading?: boolean;
}

export function ArrivalBoard({ arrivals, loading }: ArrivalBoardProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (arrivals.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No upcoming arrivals</p>
      </div>
    );
  }

  // Group arrivals by direction
  const northbound = arrivals.filter((a) => getDirectionFromStopId(a.stopId) === 'N');
  const southbound = arrivals.filter((a) => getDirectionFromStopId(a.stopId) === 'S');

  return (
    <div className="space-y-6">
      {/* Northbound */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ArrowUp className="h-4 w-4" />
          <h3 className="font-medium">Northbound / Manhattan</h3>
        </div>
        <div className="space-y-2">
          {northbound.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-6">No trains</p>
          ) : (
            northbound.slice(0, 5).map((arrival) => (
              <ArrivalRow key={`${arrival.tripId}-${arrival.stopId}`} arrival={arrival} />
            ))
          )}
        </div>
      </div>

      {/* Southbound */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ArrowDown className="h-4 w-4" />
          <h3 className="font-medium">Southbound / Brooklyn</h3>
        </div>
        <div className="space-y-2">
          {southbound.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-6">No trains</p>
          ) : (
            southbound.slice(0, 5).map((arrival) => (
              <ArrivalRow key={`${arrival.tripId}-${arrival.stopId}`} arrival={arrival} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ArrivalRow({ arrival }: { arrival: ArrivalItem }) {
  const routeId = arrival.routeId || '?';
  const color = getRouteColor(routeId);
  const textColor = getTextColorForBackground(color);

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-3">
        <Badge
          className="w-8 h-8 p-0 flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: color, color: textColor }}
        >
          {routeId}
        </Badge>
        <div>
          <p className="font-medium text-sm">{arrival.stopName || 'Unknown'}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-lg">{arrival.in}</p>
        <p className="text-xs text-muted-foreground">
          {arrival.whenLocal || '—'}
        </p>
      </div>
    </div>
  );
}
