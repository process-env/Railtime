'use client';

import { useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useSelectedTrip } from '@/stores/trip-store';
import { useStaticData } from '@/hooks';
import type { TripPlan, TripSegment } from '@/lib/trip-planner/types';

interface TripMarker {
  marker: maplibregl.Marker;
  type: 'origin' | 'destination' | 'transfer';
}

/**
 * Creates a styled marker element
 */
function createMarkerElement(
  type: 'origin' | 'destination' | 'transfer',
  label?: string
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'trip-marker';

  // Different styles for each marker type
  const styles: Record<string, { bg: string; border: string; color: string; size: string }> = {
    origin: { bg: '#22c55e', border: '#16a34a', color: '#ffffff', size: '28px' },
    destination: { bg: '#ef4444', border: '#dc2626', color: '#ffffff', size: '28px' },
    transfer: { bg: '#f59e0b', border: '#d97706', color: '#000000', size: '24px' },
  };

  const style = styles[type];

  el.style.cssText = `
    width: ${style.size};
    height: ${style.size};
    background-color: ${style.bg};
    border: 3px solid ${style.border};
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: ${type === 'transfer' ? '10px' : '14px'};
    color: ${style.color};
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    cursor: pointer;
    z-index: ${type === 'transfer' ? 10 : 20};
  `;

  // Add label text
  if (label) {
    el.textContent = label;
  }

  return el;
}

/**
 * Finds transfer stations from trip segments
 */
function findTransferStations(
  trip: TripPlan,
  stations: Record<string, { lat: number; lon: number; name?: string }>
): Array<{ id: string; name: string; lat: number; lon: number }> {
  const transfers: Array<{ id: string; name: string; lat: number; lon: number }> = [];

  trip.segments.forEach((segment: TripSegment) => {
    if (segment.type === 'transfer') {
      const station = stations[segment.fromStation.id];
      if (station) {
        transfers.push({
          id: segment.fromStation.id,
          name: segment.fromStation.name,
          lat: station.lat,
          lon: station.lon,
        });
      }
    }
  });

  return transfers;
}

interface TripMarkersProps {
  map: maplibregl.Map | null;
  mapLoaded: boolean;
}

/**
 * Component to render origin, destination, and transfer point markers
 */
export function TripMarkers({ map, mapLoaded }: TripMarkersProps) {
  const selectedTrip = useSelectedTrip();
  const { stations } = useStaticData();
  const markersRef = useRef<TripMarker[]>([]);

  // Clear all markers — stable reference via useCallback
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current = [];
  }, []);

  // Create markers when trip changes
  useEffect(() => {
    if (!map || !mapLoaded) return;

    // Clear existing markers
    clearMarkers();

    if (!selectedTrip) return;

    // Get origin station coordinates
    const originStation = stations[selectedTrip.origin.id];
    if (originStation) {
      const el = createMarkerElement('origin', 'A');
      const popup = new maplibregl.Popup({
        offset: 20,
        closeButton: false,
        closeOnClick: false,
      }).setHTML(`
        <div style="padding: 4px 8px; background: #1a1a1a; border-radius: 4px;">
          <strong style="color: #22c55e;">Start</strong>
          <br/>
          <span style="color: white;">${selectedTrip.origin.name}</span>
        </div>
      `);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([originStation.lon, originStation.lat])
        .setPopup(popup)
        .addTo(map);

      // Show popup on hover
      el.addEventListener('mouseenter', () => popup.addTo(map));
      el.addEventListener('mouseleave', () => popup.remove());

      markersRef.current.push({ marker, type: 'origin' });
    }

    // Get destination station coordinates
    const destStation = stations[selectedTrip.destination.id];
    if (destStation) {
      const el = createMarkerElement('destination', 'B');
      const popup = new maplibregl.Popup({
        offset: 20,
        closeButton: false,
        closeOnClick: false,
      }).setHTML(`
        <div style="padding: 4px 8px; background: #1a1a1a; border-radius: 4px;">
          <strong style="color: #ef4444;">End</strong>
          <br/>
          <span style="color: white;">${selectedTrip.destination.name}</span>
        </div>
      `);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([destStation.lon, destStation.lat])
        .setPopup(popup)
        .addTo(map);

      // Show popup on hover
      el.addEventListener('mouseenter', () => popup.addTo(map));
      el.addEventListener('mouseleave', () => popup.remove());

      markersRef.current.push({ marker, type: 'destination' });
    }

    // Add transfer markers
    const transfers = findTransferStations(selectedTrip, stations);
    transfers.forEach((transfer, index) => {
      const el = createMarkerElement('transfer', `${index + 1}`);
      const popup = new maplibregl.Popup({
        offset: 18,
        closeButton: false,
        closeOnClick: false,
      }).setHTML(`
        <div style="padding: 4px 8px; background: #1a1a1a; border-radius: 4px;">
          <strong style="color: #f59e0b;">Transfer ${index + 1}</strong>
          <br/>
          <span style="color: white;">${transfer.name}</span>
        </div>
      `);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([transfer.lon, transfer.lat])
        .setPopup(popup)
        .addTo(map);

      // Show popup on hover
      el.addEventListener('mouseenter', () => popup.addTo(map));
      el.addEventListener('mouseleave', () => popup.remove());

      markersRef.current.push({ marker, type: 'transfer' });
    });

    // Single cleanup — clears markers on dependency change and on unmount
    return () => {
      clearMarkers();
    };
  }, [map, mapLoaded, selectedTrip, stations, clearMarkers]);

  // This component doesn't render anything - it just manages markers
  return null;
}
