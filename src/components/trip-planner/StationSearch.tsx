'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { useStaticData } from '@/hooks';
import { MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
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
 * Station search/autocomplete input
 */
export function StationSearch({
  value,
  onSelect,
  placeholder = 'Search stations...',
  label,
  className,
}: StationSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Filter stations based on query
  const results = useMemo(() => {
    if (!query || query.length < 2) return [];
    const lower = query.toLowerCase();
    return parentStations
      .filter((s) => s.name.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [query, parentStations]);

  // Get selected station
  const selectedStation = value ? stations[value] : null;

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle station selection
  const handleSelect = (stationId: string) => {
    onSelect(stationId);
    setQuery('');
    setIsOpen(false);
  };

  // Handle clear
  const handleClear = () => {
    onSelect(null);
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      {label && (
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          {label}
        </label>
      )}

      <div className="relative">
        <MapPin className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

        <Input
          ref={inputRef}
          value={selectedStation ? selectedStation.name : query}
          onChange={(e) => {
            if (selectedStation) {
              onSelect(null);
            }
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (!selectedStation && query.length >= 2) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          className="pl-8 pr-8"
        />

        {(selectedStation || query) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && !selectedStation && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg"
        >
          {results.map((station) => (
            <button
              key={station.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => handleSelect(station.id)}
            >
              <span className="truncate font-medium">{station.name}</span>
              {station.routes.length > 0 && (
                <RouteBadges routes={station.routes} size="sm" max={6} />
              )}
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {isOpen && query.length >= 2 && results.length === 0 && !selectedStation && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-3 text-center text-sm text-muted-foreground shadow-lg"
        >
          No stations found
        </div>
      )}
    </div>
  );
}
