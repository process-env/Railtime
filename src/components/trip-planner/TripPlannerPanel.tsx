'use client';

import { Button } from '@/components/ui/button';
import { StationSearch } from './StationSearch';
import { TripResults } from './TripResults';
import { TripDetails } from './TripDetails';
import { useTripPlanner } from '@/hooks/use-trip-planner';
import { ArrowUpDown, Navigation, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TripPlannerPanelProps {
  className?: string;
}

/**
 * Main trip planner panel with station search, results, and details
 */
export function TripPlannerPanel({ className }: TripPlannerPanelProps) {
  const {
    originStationId,
    destinationStationId,
    setOrigin,
    setDestination,
    swapStations,
    planTrip,
    canPlan,
    isPlanning,
    trips,
    selectedTrip,
    selectedTripIndex,
    selectTrip,
    error,
    reset,
  } = useTripPlanner();

  const handlePlanTrip = () => {
    planTrip();
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <h2 className="text-lg font-semibold">Trip Planner</h2>
      </div>

      {/* Search inputs */}
      <div className="space-y-3 border-b border-border/50 p-4">
        <StationSearch
          value={originStationId}
          onSelect={setOrigin}
          placeholder="From station..."
          label="From"
        />

        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={swapStations}
            disabled={!originStationId && !destinationStationId}
            title="Swap stations"
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>

        <StationSearch
          value={destinationStationId}
          onSelect={setDestination}
          placeholder="To station..."
          label="To"
        />

        <Button
          className="w-full"
          onClick={handlePlanTrip}
          disabled={!canPlan}
        >
          {isPlanning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Planning...
            </>
          ) : (
            <>
              Get Directions
              <Navigation className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>

        {trips.length > 0 && (
          <Button variant="outline" className="w-full" onClick={reset}>
            Clear
          </Button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {trips.length > 0 && (
        <div className="flex-1 overflow-auto p-4 scrollbar-none">
          <div className="space-y-4">
            <TripResults
              trips={trips}
              selectedIndex={selectedTripIndex}
              onSelect={selectTrip}
            />

            {selectedTrip && (
              <div className="border-t pt-4">
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                  Step-by-step directions
                </h3>
                <TripDetails trip={selectedTrip} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {trips.length === 0 && !error && !isPlanning && (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <Navigation className="mb-3 h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Enter origin and destination stations to find the best route
          </p>
        </div>
      )}
    </div>
  );
}
