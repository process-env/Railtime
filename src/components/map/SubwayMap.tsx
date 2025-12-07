'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUIStore } from '@/stores';
import { useTrainPositions, useStaticData, useAlerts } from '@/hooks';
import { NYC_BOUNDS } from '@/lib/constants';
import { useMapAnimation, useStationMarkers, useTrainMarkers } from './hooks';
import { TrainDetailPanel } from './TrainDetailPanel';
import type { RouteDurationMatrix } from '@/lib/map/route-durations';

// Map style - CARTO Dark Matter with labels
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const REFRESH_INTERVAL = 15000; // 15 seconds
const TRAIN_POSITION_OPTIONS = { refreshInterval: REFRESH_INTERVAL };

export function SubwayMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(11);
  const poiMarkerRef = useRef<maplibregl.Marker | null>(null);

  // URL search params for POI navigation
  const searchParams = useSearchParams();

  // Static data from React Query
  const { stations } = useStaticData();
  const {
    selectedStationId,
    setSelectedStation,
    selectedRouteIds,
    mapCenter,
    mapZoom,
    setMapView,
    selectedTrainId,
    setSelectedTrain,
  } = useUIStore();

  // Train positions hook
  const { trains } = useTrainPositions(TRAIN_POSITION_OPTIONS);

  // Alerts hook for speed modulation
  const { alerts } = useAlerts();

  // Duration matrix for schedule-based animation
  const [durationMatrix, setDurationMatrix] = useState<RouteDurationMatrix | null>(null);
  const matrixLoadedRef = useRef(false);

  // Load duration matrix on mount (with guard to prevent duplicate loads)
  useEffect(() => {
    if (matrixLoadedRef.current) return;
    matrixLoadedRef.current = true;

    let mounted = true;
    import('@/lib/map/route-durations')
      .then(({ buildRouteDurationMatrix }) => buildRouteDurationMatrix())
      .then((matrix) => {
        if (mounted) setDurationMatrix(matrix);
      })
      .catch((err) => console.error('Failed to load duration matrix:', err));

    return () => { mounted = false; };
  }, []);

  // Animation hook - enable schedule-based animation
  const { trainAnimsRef, trainMotionRef, lerp, scheduleAnimation } = useMapAnimation(mapLoaded, {
    refreshInterval: REFRESH_INTERVAL,
    useAlphaBetaGamma: true,  // Enable new smooth animation system
  });

  // Station markers hook
  useStationMarkers(map.current, mapLoaded, {
    stations,
    selectedRouteIds,
    selectedStationId,
    setSelectedStation,
    currentZoom,
    trains,
  });

  // Train markers hook - with schedule-based animation + alert modulation
  const { getTrainPhase } = useTrainMarkers(map.current, mapLoaded, trainAnimsRef, trainMotionRef, lerp, {
    trains,
    selectedRouteIds,
    selectedTrainId,
    setSelectedTrain,
    refreshInterval: REFRESH_INTERVAL,
    scheduleAnimation,
    useAlphaBetaGamma: true,  // Enable new smooth animation system
    durationMatrix,  // Pre-computed durations from GTFS
    alerts,  // Service alerts for speed modulation
  });

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: mapCenter,
      zoom: mapZoom,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: NYC_BOUNDS,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.current.on('load', async () => {
      if (!map.current) return;

      // Enhance street label visibility with contrasting colors
      const labelLayers = map.current.getStyle().layers.filter(
        (layer) =>
          layer.type === 'symbol' &&
          (layer.id.includes('road') ||
            layer.id.includes('street') ||
            layer.id.includes('place') ||
            layer.id.includes('poi')) &&
          !layer.id.includes('water')
      );

      labelLayers.forEach((layer) => {
        if (!map.current) return;
        // Salmon text for visibility
        map.current.setPaintProperty(layer.id, 'text-color', '#FA8072');
        // Dark halo for contrast against any background
        map.current.setPaintProperty(layer.id, 'text-halo-color', '#000000');
        map.current.setPaintProperty(layer.id, 'text-halo-width', 1.5);
      });

      // Add subway lines GeoJSON
      try {
        const response = await fetch('/map/nyc-subway-lines.geojson');
        const geojson = await response.json();

        map.current.addSource('subway-lines', {
          type: 'geojson',
          data: geojson,
        });

        map.current.addLayer({
          id: 'subway-lines',
          type: 'line',
          source: 'subway-lines',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              10, 2,
              14, 4,
              18, 6
            ],
            'line-opacity': 0.85,
          },
        });
      } catch (err) {
        console.error('Failed to load subway lines:', err);
      }

      setMapLoaded(true);
    });

    map.current.on('moveend', () => {
      if (!map.current) return;
      const center = map.current.getCenter();
      const zoom = map.current.getZoom();
      setMapView([center.lng, center.lat], zoom);
      setCurrentZoom(zoom);
    });

    map.current.on('zoom', () => {
      if (!map.current) return;
      setCurrentZoom(map.current.getZoom());
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Pan to selected station
  useEffect(() => {
    if (!map.current || !selectedStationId || !stations[selectedStationId]) return;

    const station = stations[selectedStationId];
    map.current.flyTo({
      center: [station.lon, station.lat],
      zoom: 15,
      duration: 1000,
    });
  }, [selectedStationId, stations]);

  // Handle POI marker from URL params
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const poiParam = searchParams.get('poi');
    const poiName = searchParams.get('poiName');

    // Remove existing POI marker
    if (poiMarkerRef.current) {
      poiMarkerRef.current.remove();
      poiMarkerRef.current = null;
    }

    if (poiParam) {
      const [lat, lon] = poiParam.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lon)) {
        // Create POI marker element
        const el = document.createElement('div');
        el.className = 'poi-marker';
        el.innerHTML = `
          <div style="
            width: 32px;
            height: 32px;
            background: #EF4444;
            border: 3px solid white;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <span style="transform: rotate(45deg); font-size: 14px;">📍</span>
          </div>
        `;

        // Create and add the marker
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([lon, lat])
          .addTo(map.current);

        // Add popup with POI name
        if (poiName) {
          const popup = new maplibregl.Popup({ offset: 25, closeButton: true })
            .setHTML(`<div style="padding: 4px 8px; font-weight: 500;">${poiName}</div>`);
          marker.setPopup(popup);
          popup.addTo(map.current);
        }

        poiMarkerRef.current = marker;

        // Fly to POI location
        map.current.flyTo({
          center: [lon, lat],
          zoom: 16,
          duration: 1000,
        });
      }
    }
  }, [mapLoaded, searchParams]);

  // Find the selected train for the detail panel
  const selectedTrain = useMemo(() => {
    if (!selectedTrainId) return null;
    return trains.find((t) => t.tripId === selectedTrainId) || null;
  }, [selectedTrainId, trains]);

  // Track phase in state so it updates with animation
  const [selectedTrainPhase, setSelectedTrainPhase] = useState<'BOARDING' | 'ARRIVING' | 'APPROACHING' | null>(null);

  // Poll the phase every 500ms when a train is selected to sync with animation
  // 500ms is smooth enough for visual updates while reducing re-renders by 80%
  useEffect(() => {
    if (!selectedTrainId) {
      setSelectedTrainPhase(null);
      return;
    }

    // Initial phase
    setSelectedTrainPhase(getTrainPhase(selectedTrainId));

    // Poll for phase updates
    const interval = setInterval(() => {
      const phase = getTrainPhase(selectedTrainId);
      setSelectedTrainPhase(prev => prev !== phase ? phase : prev);
    }, 500);

    return () => clearInterval(interval);
  }, [selectedTrainId, getTrainPhase]);

  // Close train panel when train disappears from feed
  useEffect(() => {
    if (selectedTrainId && !selectedTrain) {
      setSelectedTrain(null);
    }
  }, [selectedTrainId, selectedTrain, setSelectedTrain]);

  // Show loading overlay until map and initial data are ready
  const isInitializing = !mapLoaded || trains.length === 0;

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Loading overlay - fades out when ready */}
      {isInitializing && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-20 transition-opacity duration-300">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Loading trains...</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur p-3 rounded-lg shadow-lg text-xs">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-white border-2 border-gray-600" />
          <span>Station</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-green-400 border-2 border-gray-600 animate-pulse" />
          <span>Train arriving</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 rounded legend-train-color border border-white" />
          <span>Train</span>
        </div>
        {searchParams.get('poi') && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 border-2 border-white rounded-full" />
            <span>Place</span>
          </div>
        )}
      </div>

      {/* Train count */}
      <div className="absolute top-4 left-4 bg-background/90 backdrop-blur px-3 py-2 rounded-lg shadow-lg text-sm">
        <span className="font-medium">{trains.length}</span> trains active
      </div>

      {/* Train Detail Panel */}
      <TrainDetailPanel
        train={selectedTrain}
        onClose={() => setSelectedTrain(null)}
        phase={selectedTrainPhase}
      />
    </div>
  );
}
