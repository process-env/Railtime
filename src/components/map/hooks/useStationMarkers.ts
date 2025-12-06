import { useRef, useEffect, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { MAP_CONSTANTS } from '@/lib/constants';
import {
  isParentStation,
  getParentStationId,
  stationServesAnyRoute,
} from '@/lib/mta/station-utils';
import type { Station, TrainPosition } from '@/types/mta';

export interface UseStationMarkersOptions {
  stations: Record<string, Station>;
  selectedRouteIds: string[];
  selectedStationId: string | null;
  setSelectedStation: (id: string | null) => void;
  currentZoom: number;
  trains: TrainPosition[];
}

export interface UseStationMarkersReturn {
  /** Array of stations currently displayed on the map */
  filteredStations: Station[];
}

interface MarkerData {
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;
  cleanup: () => void;
}

/**
 * Hook to manage station markers on the map
 * Handles creation, updates, selection state, and cleanup
 */
export function useStationMarkers(
  map: maplibregl.Map | null,
  mapLoaded: boolean,
  options: UseStationMarkersOptions
): UseStationMarkersReturn {
  const {
    stations,
    selectedRouteIds,
    selectedStationId,
    setSelectedStation,
    currentZoom,
    trains,
  } = options;

  // Store marker data including cleanup functions
  const markersRef = useRef<Map<string, MarkerData>>(new Map());

  // Memoize station IDs with arriving trains (with input validation)
  const arrivingStationIds = useMemo(() => {
    const ids = new Set<string>();
    trains.forEach((train) => {
      const parentId = getParentStationId(train.nextStopId);
      if (parentId) {
        ids.add(parentId);
      }
    });
    return ids;
  }, [trains]);

  // Memoize filtered stations using shared utility
  const filteredStations = useMemo(() => {
    const parentStations = Object.values(stations).filter(isParentStation);

    if (selectedRouteIds.length === 0) return parentStations;

    return parentStations.filter((s) => stationServesAnyRoute(s, selectedRouteIds));
  }, [stations, selectedRouteIds]);

  // Cleanup function for removing a marker and its event listeners
  const removeMarker = useCallback((id: string) => {
    const data = markersRef.current.get(id);
    if (data) {
      data.cleanup();
      data.popup.remove();
      data.marker.remove();
      markersRef.current.delete(id);
    }
  }, []);

  // Cleanup all markers
  const clearAllMarkers = useCallback(() => {
    markersRef.current.forEach((_, id) => removeMarker(id));
  }, [removeMarker]);

  // Add station markers - only show at zoom >= minZoom
  useEffect(() => {
    if (!mapLoaded || !map) return;

    // Hide stations at low zoom for performance
    const showStations = currentZoom >= MAP_CONSTANTS.STATION_MIN_ZOOM;

    // Clear old markers if zoom is too low
    if (!showStations) {
      clearAllMarkers();
      return;
    }

    // Update or create markers
    const currentIds = new Set(filteredStations.map((s) => s.id));

    // Remove markers that are no longer needed
    markersRef.current.forEach((_, id) => {
      if (!currentIds.has(id)) {
        removeMarker(id);
      }
    });

    filteredStations.forEach((station) => {
      const isArriving = arrivingStationIds.has(station.id);
      const isSelected = station.id === selectedStationId;

      // Update existing marker
      if (markersRef.current.has(station.id)) {
        const data = markersRef.current.get(station.id);
        if (data) {
          const el = data.marker.getElement();
          // Update size based on selection
          el.style.width = isSelected ? '18px' : '12px';
          el.style.height = isSelected ? '18px' : '12px';
          el.style.borderWidth = isSelected ? '3px' : '2px';
          // Update pulse animation
          if (isArriving) {
            el.classList.add('station-arriving');
          } else {
            el.classList.remove('station-arriving');
          }
        }
        return;
      }

      // Get station routes for popup
      const stationRoutes = station.routes?.split(/[,\s]+/) || [];

      // Create marker element - uniform white style
      const el = document.createElement('div');
      el.className = 'station-marker' + (isArriving ? ' station-arriving' : '');
      el.style.cssText = `
        width: ${isSelected ? '18px' : '12px'};
        height: ${isSelected ? '18px' : '12px'};
        background-color: #ffffff;
        border: ${isSelected ? '3px' : '2px'} solid #374151;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      `;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([station.lon, station.lat])
        .addTo(map);

      // Create popup
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: MAP_CONSTANTS.POPUP_OFFSET_STATION,
      }).setHTML(`
        <div style="padding: 4px 8px; background: #1a1a1a; border-radius: 4px;">
          <strong style="color: white;">${station.name}</strong>
          <br/>
          <span style="color: #888; font-size: 12px;">${stationRoutes.join(' ')}</span>
        </div>
      `);

      // Event handlers with proper references for cleanup
      const handleClick = () => {
        setSelectedStation(station.id === selectedStationId ? null : station.id);
      };

      const handleMouseEnter = () => {
        marker.setPopup(popup).togglePopup();
      };

      const handleMouseLeave = () => {
        popup.remove();
      };

      // Attach event listeners
      el.addEventListener('click', handleClick);
      el.addEventListener('mouseenter', handleMouseEnter);
      el.addEventListener('mouseleave', handleMouseLeave);

      // Store cleanup function
      const cleanup = () => {
        el.removeEventListener('click', handleClick);
        el.removeEventListener('mouseenter', handleMouseEnter);
        el.removeEventListener('mouseleave', handleMouseLeave);
      };

      markersRef.current.set(station.id, { marker, popup, cleanup });
    });
  }, [mapLoaded, map, filteredStations, currentZoom, selectedStationId, setSelectedStation, arrivingStationIds, removeMarker, clearAllMarkers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllMarkers();
    };
  }, [clearAllMarkers]);

  return { filteredStations };
}
