import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useUserPosition, useGeolocationStatus } from '@/stores';

/**
 * Creates a pulsing blue dot element for user location
 */
function createUserLocationElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'user-location-marker';
  el.style.cssText = `
    width: 20px;
    height: 20px;
    position: relative;
  `;

  // Outer pulsing ring
  const pulse = document.createElement('div');
  pulse.className = 'user-location-pulse';
  pulse.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    background: rgba(66, 133, 244, 0.3);
    border-radius: 50%;
    animation: userLocationPulse 2s ease-out infinite;
  `;

  // Inner dot
  const dot = document.createElement('div');
  dot.className = 'user-location-dot';
  dot.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    background: #4285F4;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    z-index: 1;
  `;

  el.appendChild(pulse);
  el.appendChild(dot);

  return el;
}

// The @keyframes userLocationPulse animation is defined in src/app/globals.css
// rather than being injected at runtime via document.createElement('style').

interface UseUserLocationMarkerOptions {
  /**
   * Whether to show accuracy circle (default: false)
   */
  showAccuracy?: boolean;
}

/**
 * Hook to render user location marker on the map
 * Subscribes to geolocation store and updates marker position
 */
export function useUserLocationMarker(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  _options: UseUserLocationMarkerOptions = {}
): void {
  const position = useUserPosition();
  const status = useGeolocationStatus();
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Create/update/remove marker based on position
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Remove marker if no position or not active
    if (!position || status !== 'active') {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    // Create marker if it doesn't exist
    if (!markerRef.current) {
      const el = createUserLocationElement();
      markerRef.current = new maplibregl.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat([position.lon, position.lat])
        .addTo(map);
    } else {
      // Update position
      markerRef.current.setLngLat([position.lon, position.lat]);
    }
  }, [mapRef, mapLoaded, position, status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);
}
