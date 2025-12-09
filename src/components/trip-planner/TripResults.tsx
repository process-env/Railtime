'use client';

import { cn } from '@/lib/utils';
import { RouteBadges } from './RouteBadge';
import type { TripPlan } from '@/lib/trip-planner/types';

interface TripResultsProps {
  trips: TripPlan[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * List of trip alternatives
 */
export function TripResults({ trips, selectedIndex, onSelect }: TripResultsProps) {
  if (trips.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">
        {trips.length} route{trips.length !== 1 ? 's' : ''} found
      </h3>
      <div className="space-y-2">
        {trips.map((trip, index) => (
          <TripCard
            key={trip.id}
            trip={trip}
            isSelected={index === selectedIndex}
            onClick={() => onSelect(index)}
            rank={index + 1}
          />
        ))}
      </div>
    </div>
  );
}

interface TripCardProps {
  trip: TripPlan;
  isSelected: boolean;
  onClick: () => void;
  rank: number;
}

function TripCard({ trip, isSelected, onClick, rank }: TripCardProps) {
  const durationMin = Math.round(trip.totalDurationSeconds / 60);
  const transferText =
    trip.totalTransfers === 0
      ? 'Direct'
      : trip.totalTransfers === 1
      ? '1 transfer'
      : `${trip.totalTransfers} transfers`;

  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:bg-accent/50'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {rank}
          </span>
          <RouteBadges routes={trip.routes} size="sm" max={4} />
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">{durationMin} min</div>
        </div>
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{transferText}</div>
    </button>
  );
}
