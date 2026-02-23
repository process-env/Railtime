'use client';

import { useState, useMemo } from 'react';
import { useStaticData } from '@/hooks';
import { MapPin, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RouteBadges } from './RouteBadge';
// Station routes mapping - loaded at build time
import stationRoutesData from '../../../public/data/station-routes.json';

// Type for the station routes data
const stationRoutes: Record<string, string[]> = stationRoutesData.stationRoutes;

interface StationSearchProps {
  value: string | null;
  onSelect: (stationId: string | null) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}

/**
 * Station search combobox using shadcn Command (cmdk) + Popover.
 * Provides proper ARIA combobox semantics, keyboard navigation, and screen reader support.
 */
export function StationSearch({
  value,
  onSelect,
  placeholder = 'Search stations...',
  label,
  className,
}: StationSearchProps) {
  const [open, setOpen] = useState(false);
  const { stations } = useStaticData();

  // Get parent stations only (no platform variants) with their routes
  const parentStations = useMemo(() => {
    return Object.values(stations)
      .filter((s) => s && !s.parent && !/[NS]$/.test(s.id))
      .map((s) => ({
        ...s,
        routes: stationRoutes[s.id] || [],
      }));
  }, [stations]);

  // Get selected station name for display
  const selectedStation = value ? stations[value] : null;

  // Handle station selection from Command item
  const handleSelect = (stationId: string) => {
    // If re-selecting the same station, deselect it
    onSelect(stationId === value ? null : stationId);
    setOpen(false);
  };

  // Handle clear
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label ?? placeholder}
            className="w-full justify-between font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              {selectedStation ? (
                <span className="truncate">{selectedStation.name}</span>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {selectedStation && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={handleClear}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(null);
                    }
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear selection"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command
            filter={(value, search) => {
              // cmdk passes the item value and the current search string.
              // We look up the station name by id and match case-insensitively.
              const station = stations[value];
              if (!station) return 0;
              return station.name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <CommandInput placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>No stations found</CommandEmpty>
              <CommandGroup>
                {parentStations.map((station) => (
                  <CommandItem
                    key={station.id}
                    value={station.id}
                    onSelect={handleSelect}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-medium">{station.name}</span>
                    {station.routes.length > 0 && (
                      <RouteBadges routes={station.routes} size="sm" max={6} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
