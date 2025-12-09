'use client';

import { RouteBadge } from './RouteBadge';
import type { TripPlan, TripSegment } from '@/lib/trip-planner/types';
import { Circle, ArrowRight, Footprints, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TripDetailsProps {
  trip: TripPlan;
}

/**
 * Step-by-step trip directions
 */
export function TripDetails({ trip }: TripDetailsProps) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between text-sm">
        <span className="truncate font-medium">{trip.origin.name}</span>
        <ArrowRight className="mx-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{trip.destination.name}</span>
      </div>

      {/* Timeline */}
      <div className="relative ml-3 border-l-2 border-border pl-6">
        {trip.segments.map((segment, index) => (
          <SegmentItem key={index} segment={segment} isLast={index === trip.segments.length - 1} />
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">Total time</span>
        <span className="font-semibold">
          {Math.round(trip.totalDurationSeconds / 60)} min
        </span>
      </div>
    </div>
  );
}

interface SegmentItemProps {
  segment: TripSegment;
  isLast: boolean;
}

function SegmentItem({ segment, isLast }: SegmentItemProps) {
  const durationMin = Math.round(segment.durationSeconds / 60);

  switch (segment.type) {
    case 'board':
      return (
        <div className="relative mb-4 -ml-[31px]">
          <div
            className={cn(
              'absolute -left-[1px] flex h-6 w-6 items-center justify-center rounded-full',
              'bg-primary text-primary-foreground'
            )}
          >
            <Circle className="h-3 w-3 fill-current" />
          </div>
          <div className="ml-8">
            <div className="flex items-center gap-2">
              <span className="font-medium">Board</span>
              {segment.routeId && <RouteBadge routeId={segment.routeId} size="sm" />}
            </div>
            <p className="text-sm text-muted-foreground">
              at {segment.fromStation.name}
              {segment.direction && (
                <span className="ml-1">toward {segment.direction}</span>
              )}
            </p>
          </div>
        </div>
      );

    case 'ride':
      return (
        <div className="relative mb-4 -ml-[31px]">
          <div className="absolute -left-[1px] flex h-6 w-6 items-center justify-center rounded-full bg-muted">
            <div className="h-2 w-2 rounded-full bg-muted-foreground" />
          </div>
          <div className="ml-8">
            <p className="text-sm">
              Ride {segment.stopCount} stop{segment.stopCount !== 1 ? 's' : ''}{' '}
              <span className="text-muted-foreground">({durationMin} min)</span>
            </p>
          </div>
        </div>
      );

    case 'transfer':
      return (
        <div className="relative mb-4 -ml-[31px]">
          <div className="absolute -left-[1px] flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500 text-white">
            <Footprints className="h-3 w-3" />
          </div>
          <div className="ml-8">
            <p className="font-medium">
              Transfer at {segment.fromStation.name}
            </p>
            <p className="text-sm text-muted-foreground">
              Walk {durationMin} min
              {segment.transferType === 'out-of-system' && (
                <span className="ml-1 text-yellow-600">(exit station)</span>
              )}
            </p>
          </div>
        </div>
      );

    case 'exit':
      return (
        <div className="relative -ml-[31px]">
          <div className="absolute -left-[1px] flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white">
            <MapPin className="h-3 w-3" />
          </div>
          <div className="ml-8">
            <p className="font-medium">Arrive at {segment.toStation.name}</p>
          </div>
        </div>
      );

    default:
      return null;
  }
}
