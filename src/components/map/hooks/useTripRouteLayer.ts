import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useSelectedTrip } from '@/stores/trip-store';
import { useStaticData } from '@/hooks';
import { getRouteColor } from '@/lib/constants';
import { getTrackIndex, type RouteTrack, haversineDistance } from '@/lib/map/track-index';
import type { TripPlan, TripSegment } from '@/lib/trip-planner/types';

// Cache for raw GeoJSON route geometries (all segments)
let rawGeoJSONCache: Map<string, [number, number][][]> | null = null;
let rawGeoJSONLoadPromise: Promise<Map<string, [number, number][][]>> | null = null;

/**
 * Load raw GeoJSON with all route segments (not flattened)
 */
async function loadRawRouteGeometries(): Promise<Map<string, [number, number][][]>> {
  if (rawGeoJSONCache) return rawGeoJSONCache;

  if (!rawGeoJSONLoadPromise) {
    rawGeoJSONLoadPromise = fetch('/map/nyc-subway-lines.geojson')
      .then(res => res.json())
      .then(geojson => {
        const map = new Map<string, [number, number][][]>();
        for (const feature of geojson.features) {
          const routeId = feature.properties?.route_id;
          if (routeId && feature.geometry?.type === 'MultiLineString') {
            map.set(routeId, feature.geometry.coordinates);
          }
        }
        rawGeoJSONCache = map;
        return map;
      });
  }

  return rawGeoJSONLoadPromise;
}

/**
 * Find the best matching segment from all route segments
 * Returns the segment that contains points closest to both stations
 */
function findBestSegmentForStations(
  segments: [number, number][][],
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): { segment: [number, number][]; fromIdx: number; toIdx: number } | null {
  let bestMatch: { segment: [number, number][]; fromIdx: number; toIdx: number; totalDist: number } | null = null;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx];

    // Find closest point to "from" station
    let fromIdx = 0;
    let fromMinDist = Infinity;
    for (let i = 0; i < segment.length; i++) {
      const dist = haversineDistance(fromLat, fromLon, segment[i][1], segment[i][0]);
      if (dist < fromMinDist) {
        fromMinDist = dist;
        fromIdx = i;
      }
    }

    // Find closest point to "to" station
    let toIdx = 0;
    let toMinDist = Infinity;
    for (let i = 0; i < segment.length; i++) {
      const dist = haversineDistance(toLat, toLon, segment[i][1], segment[i][0]);
      if (dist < toMinDist) {
        toMinDist = dist;
        toIdx = i;
      }
    }

    // Only consider if both stations are close to this segment (within 1000m)
    // Some stations may be slightly farther from the line
    if (fromMinDist < 1000 && toMinDist < 1000) {
      const totalDist = fromMinDist + toMinDist;
      if (!bestMatch || totalDist < bestMatch.totalDist) {
        bestMatch = { segment, fromIdx, toIdx, totalDist };
      }
    }
  }

  return bestMatch;
}

/**
 * Extract coordinates between two indices on a segment
 */
function extractSegmentBetweenIndices(
  segment: [number, number][],
  fromIdx: number,
  toIdx: number
): [number, number][] {
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  const result = segment.slice(start, end + 1);
  return fromIdx > toIdx ? result.reverse() : result;
}

const TRIP_ROUTE_SOURCE = 'trip-route';
const TRIP_ROUTE_CASING_LAYER = 'trip-route-casing';
const TRIP_ROUTE_LINE_LAYER = 'trip-route-line';
const TRIP_ROUTE_TRANSFER_LAYER = 'trip-route-transfer';

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    color: string;
    type: 'ride' | 'transfer';
    routeId?: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/**
 * Creates an empty GeoJSON feature collection
 */
function emptyFeatureCollection(): GeoJSONFeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Project a station's lat/lon onto the track and return the arclength
 */
function projectStationToTrack(
  lat: number,
  lon: number,
  track: RouteTrack
): number {
  const { coords, cumDists } = track;

  let minDist = Infinity;
  let bestS = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    // Vector from p1 to p2
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    const segLenSq = dx * dx + dy * dy;

    if (segLenSq === 0) continue;

    // Project point onto segment
    const t = Math.max(0, Math.min(1,
      ((lon - lon1) * dx + (lat - lat1) * dy) / segLenSq
    ));

    // Closest point on segment
    const closeLon = lon1 + t * dx;
    const closeLat = lat1 + t * dy;

    const dist = haversineDistance(lat, lon, closeLat, closeLon);
    if (dist < minDist) {
      minDist = dist;
      const segLen = cumDists[i + 1] - cumDists[i];
      bestS = cumDists[i] + t * segLen;
    }
  }

  return bestS;
}

/**
 * Find arclength for a station on a track, with fallback to projection
 */
function findStationArclength(
  stationId: string,
  stationCoords: { lat: number; lon: number },
  track: RouteTrack
): number | undefined {
  // Try exact match first
  let arclength = track.stations.get(stationId);
  if (arclength !== undefined) return arclength;

  // Try with N suffix
  arclength = track.stations.get(stationId + 'N');
  if (arclength !== undefined) return arclength;

  // Try with S suffix
  arclength = track.stations.get(stationId + 'S');
  if (arclength !== undefined) return arclength;

  // Fallback: project station coordinates onto track
  // Only use if the station is within 500m of the track
  const projectedS = projectStationToTrack(stationCoords.lat, stationCoords.lon, track);

  // Verify it's close enough to the track
  const projectedCoord = extractPointAtArclength(track, projectedS);
  if (projectedCoord) {
    const dist = haversineDistance(
      stationCoords.lat, stationCoords.lon,
      projectedCoord[1], projectedCoord[0]
    );
    if (dist < 500) {
      return projectedS;
    }
  }

  return undefined;
}

/**
 * Get [lon, lat] at a given arclength
 */
function extractPointAtArclength(
  track: RouteTrack,
  s: number
): [number, number] | null {
  const { coords, cumDists, totalLength } = track;

  if (coords.length === 0) return null;

  s = Math.max(0, Math.min(s, totalLength));

  // Find segment
  let lo = 0;
  let hi = cumDists.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cumDists[mid] <= s) lo = mid;
    else hi = mid;
  }

  if (lo >= coords.length - 1) {
    return coords[coords.length - 1];
  }

  const segStart = cumDists[lo];
  const segEnd = cumDists[lo + 1];
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (s - segStart) / segLen : 0;

  const [lon1, lat1] = coords[lo];
  const [lon2, lat2] = coords[lo + 1];

  return [
    lon1 + t * (lon2 - lon1),
    lat1 + t * (lat2 - lat1)
  ];
}

/**
 * Extract track coordinates between two arclength values
 */
function extractTrackSegment(
  track: RouteTrack,
  sFrom: number,
  sTo: number
): [number, number][] {
  const { coords, cumDists, totalLength } = track;

  if (coords.length < 2) return [];

  // Ensure sFrom <= sTo for processing
  const [minS, maxS] = sFrom < sTo ? [sFrom, sTo] : [sTo, sFrom];
  const reverse = sFrom > sTo;

  // Clamp to track bounds
  const clampedMin = Math.max(0, Math.min(minS, totalLength));
  const clampedMax = Math.max(0, Math.min(maxS, totalLength));

  // Find start segment (where clampedMin falls)
  let startSegIdx = 0;
  for (let i = 0; i < cumDists.length - 1; i++) {
    if (cumDists[i] <= clampedMin && cumDists[i + 1] >= clampedMin) {
      startSegIdx = i;
      break;
    }
  }

  // Find end segment (where clampedMax falls)
  let endSegIdx = cumDists.length - 2;
  for (let i = 0; i < cumDists.length - 1; i++) {
    if (cumDists[i] <= clampedMax && cumDists[i + 1] >= clampedMax) {
      endSegIdx = i;
      break;
    }
  }

  const result: [number, number][] = [];

  // Interpolate start point
  {
    const segStart = cumDists[startSegIdx];
    const segEnd = cumDists[startSegIdx + 1];
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (clampedMin - segStart) / segLen : 0;
    const [lon1, lat1] = coords[startSegIdx];
    const [lon2, lat2] = coords[startSegIdx + 1];
    result.push([
      lon1 + t * (lon2 - lon1),
      lat1 + t * (lat2 - lat1)
    ]);
  }

  // Add all intermediate vertices between start and end segments
  for (let i = startSegIdx + 1; i <= endSegIdx; i++) {
    result.push(coords[i]);
  }

  // Interpolate end point
  {
    const segStart = cumDists[endSegIdx];
    const segEnd = cumDists[endSegIdx + 1];
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (clampedMax - segStart) / segLen : 0;
    const [lon1, lat1] = coords[endSegIdx];
    const [lon2, lat2] = coords[endSegIdx + 1];
    result.push([
      lon1 + t * (lon2 - lon1),
      lat1 + t * (lat2 - lat1)
    ]);
  }

  // Remove duplicates (points that are very close together)
  const deduped: [number, number][] = [];
  for (const coord of result) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(coord[0] - last[0]) > 0.000001 || Math.abs(coord[1] - last[1]) > 0.000001) {
      deduped.push(coord);
    }
  }

  return reverse ? deduped.reverse() : deduped;
}

/**
 * Normalize route ID to base route for track matching
 * E.g., 7X -> 7, 6X -> 6, FX -> F
 */
function normalizeRouteId(routeId: string): string {
  // Remove X suffix for express trains (they share track with local)
  if (routeId.endsWith('X')) {
    return routeId.slice(0, -1);
  }
  return routeId;
}

/**
 * Converts a trip plan to GeoJSON line features using actual track geometry
 */
async function tripToGeoJSON(
  trip: TripPlan | null,
  stations: Record<string, { lat: number; lon: number }>
): Promise<GeoJSONFeatureCollection> {
  if (!trip || trip.segments.length === 0) {
    return emptyFeatureCollection();
  }

  const features: GeoJSONFeature[] = [];

  // Load track index for route geometry
  let trackIndex;
  try {
    trackIndex = await getTrackIndex();
  } catch (error) {
    console.error('Failed to load track index:', error);
    // Fall back to straight lines
    return tripToGeoJSONFallback(trip, stations);
  }

  // Also load raw GeoJSON for fallback (handles multi-segment routes like 7 train)
  let rawGeometries: Map<string, [number, number][][]> | null = null;
  try {
    rawGeometries = await loadRawRouteGeometries();
  } catch (error) {
    console.warn('Failed to load raw geometries:', error);
  }

  // Process each segment
  for (const segment of trip.segments) {
    if (segment.type !== 'ride' && segment.type !== 'transfer') {
      continue;
    }

    const fromStation = stations[segment.fromStation.id];
    const toStation = stations[segment.toStation.id];

    if (!fromStation || !toStation) {
      continue;
    }

    if (segment.type === 'ride' && segment.routeId) {
      let foundTrack = false;
      // Normalize route ID for track lookup (e.g., 7X -> 7)
      const trackRouteId = normalizeRouteId(segment.routeId);
      const track = trackIndex.routes.get(trackRouteId);

      if (track) {
        // Get arclengths for the stations on this route (with coordinate fallback)
        const fromArclength = findStationArclength(
          segment.fromStation.id,
          fromStation,
          track
        );
        const toArclength = findStationArclength(
          segment.toStation.id,
          toStation,
          track
        );

        if (fromArclength !== undefined && toArclength !== undefined) {
          // Extract actual track geometry between stations
          const coordinates = extractTrackSegment(track, fromArclength, toArclength);

          if (coordinates.length >= 2) {
            features.push({
              type: 'Feature',
              properties: {
                color: getRouteColor(segment.routeId),
                type: 'ride',
                routeId: segment.routeId,
              },
              geometry: {
                type: 'LineString',
                coordinates,
              },
            });
            foundTrack = true;
          }
        }
      }

      // Fallback: try raw GeoJSON with all segments (for routes like 7 train)
      if (!foundTrack && rawGeometries) {
        const routeSegments = rawGeometries.get(trackRouteId);
        if (routeSegments) {
          const match = findBestSegmentForStations(
            routeSegments,
            fromStation.lat, fromStation.lon,
            toStation.lat, toStation.lon
          );

          if (match) {
            const coordinates = extractSegmentBetweenIndices(
              match.segment,
              match.fromIdx,
              match.toIdx
            );

            if (coordinates.length >= 2) {
              features.push({
                type: 'Feature',
                properties: {
                  color: getRouteColor(segment.routeId),
                  type: 'ride',
                  routeId: segment.routeId,
                },
                geometry: {
                  type: 'LineString',
                  coordinates,
                },
              });
              foundTrack = true;
            }
          }
        }
      }

      // Final fallback: straight line
      if (!foundTrack) {
        features.push({
          type: 'Feature',
          properties: {
            color: getRouteColor(segment.routeId),
            type: 'ride',
            routeId: segment.routeId,
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [fromStation.lon, fromStation.lat],
              [toStation.lon, toStation.lat],
            ],
          },
        });
      }
    } else if (segment.type === 'transfer') {
      features.push({
        type: 'Feature',
        properties: {
          color: '#888888',
          type: 'transfer',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [fromStation.lon, fromStation.lat],
            [toStation.lon, toStation.lat],
          ],
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Fallback: straight lines between stations
 */
function tripToGeoJSONFallback(
  trip: TripPlan,
  stations: Record<string, { lat: number; lon: number }>
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  trip.segments.forEach((segment: TripSegment) => {
    if (segment.type !== 'ride' && segment.type !== 'transfer') return;

    const fromStation = stations[segment.fromStation.id];
    const toStation = stations[segment.toStation.id];

    if (!fromStation || !toStation) return;

    const coordinates: [number, number][] = [
      [fromStation.lon, fromStation.lat],
      [toStation.lon, toStation.lat],
    ];

    if (segment.type === 'ride' && segment.routeId) {
      features.push({
        type: 'Feature',
        properties: {
          color: getRouteColor(segment.routeId),
          type: 'ride',
          routeId: segment.routeId,
        },
        geometry: { type: 'LineString', coordinates },
      });
    } else if (segment.type === 'transfer') {
      features.push({
        type: 'Feature',
        properties: {
          color: '#888888',
          type: 'transfer',
        },
        geometry: { type: 'LineString', coordinates },
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

/**
 * Hook to render trip route on the map with pulsating animation
 */
export function useTripRouteLayer(
  map: maplibregl.Map | null,
  mapLoaded: boolean
): void {
  const selectedTrip = useSelectedTrip();
  const { stations } = useStaticData();
  const sourceAddedRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const [_dashOffset, _setDashOffset] = useState(0);

  // Add source and layers when map is ready
  const setupLayers = useCallback(() => {
    if (!map || !mapLoaded || sourceAddedRef.current) return;

    if (map.getSource(TRIP_ROUTE_SOURCE)) {
      sourceAddedRef.current = true;
      return;
    }

    map.addSource(TRIP_ROUTE_SOURCE, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    });

    // Casing layer - pulsating glow effect
    map.addLayer({
      id: TRIP_ROUTE_CASING_LAYER,
      type: 'line',
      source: TRIP_ROUTE_SOURCE,
      filter: ['==', ['get', 'type'], 'ride'],
      paint: {
        'line-color': '#ffffff',
        'line-width': 14,
        'line-opacity': 0.5,
        'line-blur': 4,
      },
    });

    // Main line layer for ride segments
    map.addLayer({
      id: TRIP_ROUTE_LINE_LAYER,
      type: 'line',
      source: TRIP_ROUTE_SOURCE,
      filter: ['==', ['get', 'type'], 'ride'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 6,
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Dashed line layer for transfer/walking segments
    map.addLayer({
      id: TRIP_ROUTE_TRANSFER_LAYER,
      type: 'line',
      source: TRIP_ROUTE_SOURCE,
      filter: ['==', ['get', 'type'], 'transfer'],
      paint: {
        'line-color': '#888888',
        'line-width': 4,
        'line-opacity': 0.8,
        'line-dasharray': [2, 2],
      },
    });

    sourceAddedRef.current = true;
  }, [map, mapLoaded]);

  // Setup layers on mount
  useEffect(() => {
    setupLayers();
  }, [setupLayers]);

  // Update the route when selected trip changes
  useEffect(() => {
    if (!map || !mapLoaded || !sourceAddedRef.current) return;

    const source = map.getSource(TRIP_ROUTE_SOURCE) as maplibregl.GeoJSONSource;
    if (!source) return;

    // Async update
    tripToGeoJSON(selectedTrip, stations).then((geojson) => {
      if (source) {
        source.setData(geojson);
      }
    });
  }, [map, mapLoaded, selectedTrip, stations]);

  // Pulsating animation for the casing layer
  useEffect(() => {
    if (!map || !mapLoaded || !selectedTrip) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    let startTime: number | null = null;

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;

      // Pulse every 2 seconds - use (sin+1)/2 to get 0-1 range
      const phase = (elapsed % 2000) / 2000;
      const sinValue = (Math.sin(phase * Math.PI * 2) + 1) / 2; // 0 to 1
      const opacity = 0.3 + 0.4 * sinValue; // 0.3 to 0.7
      const width = 10 + 6 * sinValue; // 10 to 16

      if (map.getLayer(TRIP_ROUTE_CASING_LAYER)) {
        map.setPaintProperty(TRIP_ROUTE_CASING_LAYER, 'line-opacity', opacity);
        map.setPaintProperty(TRIP_ROUTE_CASING_LAYER, 'line-width', width);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [map, mapLoaded, selectedTrip]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (!map) return;

      if (map.getLayer(TRIP_ROUTE_TRANSFER_LAYER)) {
        map.removeLayer(TRIP_ROUTE_TRANSFER_LAYER);
      }
      if (map.getLayer(TRIP_ROUTE_LINE_LAYER)) {
        map.removeLayer(TRIP_ROUTE_LINE_LAYER);
      }
      if (map.getLayer(TRIP_ROUTE_CASING_LAYER)) {
        map.removeLayer(TRIP_ROUTE_CASING_LAYER);
      }
      if (map.getSource(TRIP_ROUTE_SOURCE)) {
        map.removeSource(TRIP_ROUTE_SOURCE);
      }

      sourceAddedRef.current = false;
    };
  }, [map]);
}

/**
 * Calculate bounds that encompass all stations in the trip
 */
export function getTripBounds(
  trip: TripPlan | null,
  stations: Record<string, { lat: number; lon: number }>
): maplibregl.LngLatBoundsLike | null {
  if (!trip || trip.segments.length === 0) return null;

  const coords: [number, number][] = [];

  trip.segments.forEach((segment) => {
    const fromStation = stations[segment.fromStation.id];
    const toStation = stations[segment.toStation.id];

    if (fromStation) {
      coords.push([fromStation.lon, fromStation.lat]);
    }
    if (toStation) {
      coords.push([toStation.lon, toStation.lat]);
    }
  });

  if (coords.length === 0) return null;

  let minLng = coords[0][0];
  let maxLng = coords[0][0];
  let minLat = coords[0][1];
  let maxLat = coords[0][1];

  coords.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
