'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Locate, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useGeolocationStore, useGeolocationStatus, useUserPosition } from '@/stores';
import type maplibregl from 'maplibre-gl';

interface MyLocationButtonProps {
  mapRef: React.RefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
}

/**
 * Button to request user location and center map on it
 */
export function MyLocationButton({ mapRef, mapLoaded }: MyLocationButtonProps) {
  const status = useGeolocationStatus();
  const position = useUserPosition();
  const { watchLocation, error, clearError } = useGeolocationStore();

  // Guard: only auto-flyTo on the first location acquisition after mount.
  // Without this, every re-render that sees (position + active) would re-trigger
  // the flyTo animation. The user can still manually fly via the button click.
  const hasFlewToRef = useRef(false);

  // Handle button click
  const handleClick = useCallback(() => {
    // Clear any previous error
    clearError();

    // If we already have a position, just fly to it
    if (position && status === 'active') {
      mapRef.current?.flyTo({
        center: [position.lon, position.lat],
        zoom: 15,
        duration: 1000,
      });
      return;
    }

    // Otherwise, request location and start watching
    watchLocation();
  }, [position, status, mapRef, watchLocation, clearError]);

  // Fly to position when it first becomes available (one-shot after mount)
  useEffect(() => {
    const map = mapRef.current;
    if (position && status === 'active' && map && mapLoaded && !hasFlewToRef.current) {
      hasFlewToRef.current = true;
      map.flyTo({
        center: [position.lon, position.lat],
        zoom: 15,
        duration: 1000,
      });
    }
  }, [position, status, mapRef, mapLoaded]);

  // Determine button state
  const isLoading = status === 'requesting';
  const isError = status === 'error' || status === 'denied';
  const isActive = status === 'active' && position !== null;

  // Tooltip content based on status
  let tooltipText = 'Show my location';
  if (isLoading) {
    tooltipText = 'Getting location...';
  } else if (status === 'denied') {
    tooltipText = 'Location access denied';
  } else if (isError && error) {
    tooltipText = error;
  } else if (isActive) {
    tooltipText = 'Center on my location';
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isError ? 'destructive' : isActive ? 'default' : 'secondary'}
          size="icon"
          onClick={handleClick}
          disabled={isLoading}
          className="w-10 h-10 rounded-full shadow-lg"
          aria-label={tooltipText}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isError ? (
            <AlertCircle className="w-5 h-5" />
          ) : (
            <Locate className={`w-5 h-5 ${isActive ? 'text-primary-foreground' : ''}`} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}
