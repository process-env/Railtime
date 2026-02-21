/**
 * useTrainMarkers - Manage train markers with schedule-based animation
 *
 * Handles:
 * - Marker creation/removal based on API data
 * - Motion state initialization with duration matrix
 * - Alert-based speed modulation
 * - Segment change detection and hybrid sync
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { getRouteColor, MAP_CONSTANTS } from '@/lib/constants';
import { getDirectionFromStopId, formatEta, getDirectionLabel, getTextColorForBackground } from '@/lib/mta/format';
import { useUIStore } from '@/stores';
import { calculateTrainOffsets, type TrainWithPosition } from '@/lib/map/cluster-trains';
import type { TrainPosition, ServiceAlert } from '@/types/mta';
import type { TrainAnimState, TrainMotionState } from './useMapAnimation';
import type { RouteTrack } from '@/lib/map/track-index';
import type { RouteDurationMatrix } from '@/lib/map/route-durations';
import type { FilterState } from '@/lib/map/alpha-beta-gamma';
import type { TrainAnimationState, TrainAction } from '@/lib/map/train-state-machine';

export interface UseTrainMarkersOptions {
  trains: TrainPosition[];
  selectedRouteIds: string[];
  selectedTrainId: string | null;
  setSelectedTrain: (tripId: string | null) => void;
  refreshInterval: number;
  scheduleAnimation: () => void;
  useAlphaBetaGamma?: boolean;  // Enable new animation system
  durationMatrix?: RouteDurationMatrix | null;  // Pre-computed durations
  alerts?: ServiceAlert[];  // Current service alerts
}

export interface UseTrainMarkersReturn {
  visibleTrainCount: number;
  latestApiDataRef: React.MutableRefObject<Map<string, ApiDataEntry>>;
  getTrainPhase: (tripId: string) => 'BOARDING' | 'ARRIVING' | 'APPROACHING' | null;
}

// API data ref type for animation sync
export interface ApiDataEntry {
  prevStopId: string;
  nextStopId: string;
  prevTimeMs: number;
  nextTimeMs: number;
  prevS: number;
  nextS: number;
  apiProgress: number;
}

// Dynamic imports to avoid SSR issues
let getRouteTrack: ((routeId: string) => Promise<RouteTrack | undefined>) | null = null;
let getStopArclength: ((routeId: string, stopId: string) => Promise<number | undefined>) | null = null;
let createFilterState: ((initialS: number, initialV?: number, initialA?: number, timestamp?: number) => FilterState) | null = null;
let getSegmentDuration: ((matrix: RouteDurationMatrix, routeId: string, fromStopId: string, toStopId: string) => number | undefined) | null = null;
let _getRouteSpeedMultiplier: ((alerts: ServiceAlert[], routeId: string) => number) | null = null;
let _createTrainAnimationState: ((tripId: string, routeId: string, prevStopId: string, nextStopId: string, prevS: number, nextS: number, nowMs: number, initialProgress?: number, scheduledDuration?: number, speedMultiplier?: number) => TrainAnimationState) | null = null;
let trainAnimationReducer: ((state: TrainAnimationState, action: TrainAction) => TrainAnimationState) | null = null;

async function loadTrackUtils() {
  if (!getRouteTrack) {
    const [trackModule, filterModule, durationModule, alertModule, stateMachineModule] = await Promise.all([
      import('@/lib/map/track-index'),
      import('@/lib/map/alpha-beta-gamma'),
      import('@/lib/map/route-durations'),
      import('@/lib/map/alert-speed'),
      import('@/lib/map/train-state-machine')
    ]);
    getRouteTrack = trackModule.getRouteTrack;
    getStopArclength = trackModule.getStopArclength;
    createFilterState = filterModule.createFilterState;
    getSegmentDuration = durationModule.getSegmentDuration;
    _getRouteSpeedMultiplier = alertModule.getRouteSpeedMultiplier;
    _createTrainAnimationState = stateMachineModule.createTrainAnimationState;
    trainAnimationReducer = stateMachineModule.trainAnimationReducer;
  }
}

// Terminal stations - module-level constant for performance (avoid recreating Set on each render)
const TERMINAL_STOPS = new Set([
  // 1 line
  '101', '101N', '101S', // Van Cortlandt Park-242 St
  '142', '142N', '142S', // South Ferry
  // 2 line
  '201', '201N', '201S', // Wakefield-241 St
  '247', '247N', '247S', // Flatbush Av-Brooklyn College
  // 3 line
  '301', '301N', '301S', // Harlem-148 St
  '257', '257N', '257S', // New Lots Av
  // 4 line
  '401', '401N', '401S', // Woodlawn
  '423', '423N', '423S', // Crown Heights-Utica Av
  // 5 line
  '501', '501N', '501S', // Eastchester-Dyre Av
  '416', '416N', '416S', // 180 St (Bronx terminal)
  // 6 line
  '601', '601N', '601S', // Pelham Bay Park
  '640', '640N', '640S', // Brooklyn Bridge-City Hall
  // 7 line
  '701', '701N', '701S', // Flushing-Main St
  '726', '726N', '726S', // 34 St-Hudson Yards
  // A line
  'A02', 'A02N', 'A02S', // Inwood-207 St
  'H11', 'H11N', 'H11S', // Far Rockaway-Mott Av
  'A65', 'A65N', 'A65S', // Ozone Park-Lefferts Blvd
  // Other major terminals
  'G22', 'G22N', 'G22S', // Church Av (G)
  'G26', 'G26N', 'G26S', // Court Sq (G)
  'L01', 'L01N', 'L01S', // 8 Av (L)
  'L29', 'L29N', 'L29S', // Canarsie-Rockaway Pkwy (L)
]);

// Grace period: keep train visible for 5 minutes after API removes it
const CULL_GRACE_PERIOD_MS = 300000;

const FADE_DURATION_MS = 300;

interface FadingMarker {
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;
  timeoutId: ReturnType<typeof setTimeout>;
  motionState?: TrainMotionState;
  animState?: TrainAnimState;
}

/**
 * Hook to manage train markers with smooth animation
 */
export function useTrainMarkers(
  map: maplibregl.Map | null,
  mapLoaded: boolean,
  trainAnimsRef: React.MutableRefObject<Map<string, TrainAnimState>>,
  trainMotionRef: React.MutableRefObject<Map<string, TrainMotionState>>,
  lerp: (start: number, end: number, t: number) => number,
  options: UseTrainMarkersOptions
): UseTrainMarkersReturn {
  const {
    trains,
    selectedRouteIds,
    selectedTrainId,
    setSelectedTrain,
    refreshInterval,
    scheduleAnimation,
    useAlphaBetaGamma = true,  // Default to new system
    durationMatrix = null,
    alerts = [],
  } = options;

  const trackUtilsLoaded = useRef(false);
  const [, forceUpdate] = useState(0);

  // Ref to hold latest API data for animation loop (no re-render on update)
  const latestApiDataRef = useRef<Map<string, ApiDataEntry>>(new Map());

  // Dedup stability: persist previous poll's winners to prevent flip-flopping
  const dedupWinnersRef = useRef(new Map<string, string>()); // dedupKey → tripId

  // Track markers that are mid-fade-out so we can cancel if train reappears
  const fadingOutRef = useRef(new Map<string, FadingMarker>());

  // Load track utilities on mount
  useEffect(() => {
    if (useAlphaBetaGamma) {
      loadTrackUtils().then(() => {
        trackUtilsLoaded.current = true;
        forceUpdate(n => n + 1);
      });
    }
  }, [useAlphaBetaGamma]);

  // Update latestApiDataRef whenever trains change (for animation loop to read)
  useEffect(() => {
    if (!trackUtilsLoaded.current || !getStopArclength) return;

    const updateApiData = async () => {
      const nowMs = Date.now();

      for (const train of trains) {
        // Get arclengths for this train's segment
        const prevS = train.prevStopId
          ? await getStopArclength!(train.routeId, train.prevStopId)
          : undefined;
        const nextS = await getStopArclength!(train.routeId, train.nextStopId);

        if (prevS === undefined || nextS === undefined) continue;

        // Calculate API-based progress
        const totalDuration = (train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs);
        const elapsed = nowMs - (train.prevTimeMs || nowMs);
        const apiProgress = totalDuration > 0 ? Math.max(0, Math.min(1, elapsed / totalDuration)) : 0;

        latestApiDataRef.current.set(train.tripId, {
          prevStopId: train.prevStopId || '',
          nextStopId: train.nextStopId,
          prevTimeMs: train.prevTimeMs || nowMs,
          nextTimeMs: train.nextTimeMs || nowMs + 90000,
          prevS,
          nextS,
          apiProgress
        });
      }

      // Clean up old entries
      const currentTripIds = new Set(trains.map(t => t.tripId));
      latestApiDataRef.current.forEach((_, tripId) => {
        if (!currentTripIds.has(tripId)) {
          latestApiDataRef.current.delete(tripId);
        }
      });
    };

    updateApiData();
  }, [trains]);

  // Helper to calculate distance between two points
  const getDistance = useCallback((lng1: number, lat1: number, lng2: number, lat2: number) => {
    return Math.sqrt(Math.pow(lng2 - lng1, 2) + Math.pow(lat2 - lat1, 2));
  }, []);

  // Fade out a marker over FADE_DURATION_MS, then remove it from the DOM
  const fadeOutAndRemove = useCallback((
    tripId: string,
    marker: maplibregl.Marker,
    popup: maplibregl.Popup,
    motionState?: TrainMotionState,
    animState?: TrainAnimState
  ) => {
    if (fadingOutRef.current.has(tripId)) return; // Already fading

    marker.getElement().style.opacity = '0';
    popup.remove();

    const timeoutId = setTimeout(() => {
      marker.remove();
      fadingOutRef.current.delete(tripId);
    }, FADE_DURATION_MS);

    fadingOutRef.current.set(tripId, { marker, popup, timeoutId, motionState, animState });
  }, []);

  // Update train markers
  useEffect(() => {
    if (!mapLoaded || !map) return;

    // Filter trains by selected routes
    const filteredTrains = selectedRouteIds.length > 0
      ? trains.filter((t) => selectedRouteIds.includes(t.routeId.toUpperCase()))
      : trains;

    // Deduplicate trains on the same segment — show max 1 per route per segment.
    // Key includes prevStopId so trains on different segments (approaching same stop
    // from different directions) are NOT deduped.
    const prevWinners = dedupWinnersRef.current;
    const newWinners = new Map<string, string>();
    const stopExclude = new Set<string>();

    // First pass: group trains by dedup key
    const keyGroups = new Map<string, string[]>(); // key → tripIds
    for (const train of filteredTrains) {
      const key = `${train.routeId}:${train.prevStopId ?? ''}:${train.nextStopId}`;
      const group = keyGroups.get(key);
      if (group) {
        group.push(train.tripId);
      } else {
        keyGroups.set(key, [train.tripId]);
      }
    }

    // Second pass: pick winner per key, preferring previous winner for stability
    for (const [key, tripIds] of keyGroups) {
      const prevWinner = prevWinners.get(key);
      const winner = (prevWinner && tripIds.includes(prevWinner))
        ? prevWinner
        : tripIds[0];
      newWinners.set(key, winner);
      for (const tripId of tripIds) {
        if (tripId !== winner) stopExclude.add(tripId);
      }
    }

    dedupWinnersRef.current = newWinners;

    const displayTrains = stopExclude.size > 0
      ? filteredTrains.filter(t => !stopExclude.has(t.tripId))
      : filteredTrains;

    // Calculate clustering offsets for overlapping trains
    const trainsWithPosition: TrainWithPosition[] = displayTrains.map(t => ({
      tripId: t.tripId,
      lat: t.lat,
      lon: t.lon,
      routeId: t.routeId,
    }));
    const trainOffsets = calculateTrainOffsets(trainsWithPosition);

    const currentTripIds = new Set(displayTrains.map((t) => t.tripId));
    const now = performance.now();
    const nowMs = Date.now();

    // Remove old markers
    // - If route filter is active and train's route doesn't match: remove immediately
    // - If train disappeared from API: apply grace period logic
    trainAnimsRef.current.forEach((anim, tripId) => {
      if (!currentTripIds.has(tripId)) {
        // If route filter is active, check if this train's route is filtered out
        const routeFilterActive = selectedRouteIds.length > 0;
        const trainRouteMatchesFilter = selectedRouteIds.includes(anim.routeId?.toUpperCase() || '');
        const isFilteredOut = routeFilterActive && !trainRouteMatchesFilter;

        if (isFilteredOut) {
          // User filtered this route out - remove with fade
          fadeOutAndRemove(tripId, anim.marker, anim.popup, undefined, anim);
          trainAnimsRef.current.delete(tripId);
        } else {
          // Train disappeared from API - apply grace period
          const timeSinceUpdate = nowMs - (anim.startTime || 0);
          const atTerminal = TERMINAL_STOPS.has(anim.nextStopName || '');

          if (atTerminal || timeSinceUpdate > CULL_GRACE_PERIOD_MS) {
            fadeOutAndRemove(tripId, anim.marker, anim.popup, undefined, anim);
            trainAnimsRef.current.delete(tripId);
          }
        }
      }
    });

    trainMotionRef.current.forEach((state, tripId) => {
      if (!currentTripIds.has(tripId)) {
        // If route filter is active, check if this train's route is filtered out
        const routeFilterActive = selectedRouteIds.length > 0;
        const trainRouteMatchesFilter = selectedRouteIds.includes(state.routeId?.toUpperCase() || '');
        const isFilteredOut = routeFilterActive && !trainRouteMatchesFilter;

        if (isFilteredOut) {
          // User filtered this route out - remove with fade
          fadeOutAndRemove(tripId, state.marker, state.popup, state);
          trainMotionRef.current.delete(tripId);
        } else {
          // Train disappeared from API - apply grace period
          const timeSinceUpdate = nowMs - state.lastApiUpdate;
          const atTerminal = TERMINAL_STOPS.has(state.nextStopId);

          if (atTerminal || timeSinceUpdate > CULL_GRACE_PERIOD_MS) {
            fadeOutAndRemove(tripId, state.marker, state.popup, state);
            trainMotionRef.current.delete(tripId);
          }
        }
      }
    });

    // Process each train
    displayTrains.forEach(async (train) => {
      // If this train is mid-fade-out, cancel the fade and restore it
      const fading = fadingOutRef.current.get(train.tripId);
      if (fading) {
        clearTimeout(fading.timeoutId);
        fadingOutRef.current.delete(train.tripId);
        fading.marker.getElement().style.opacity = '1';
        // Restore to ref maps so the existing-marker check below finds it
        if (fading.motionState) {
          trainMotionRef.current.set(train.tripId, fading.motionState);
        } else if (fading.animState) {
          trainAnimsRef.current.set(train.tripId, fading.animState);
        }
      }

      const color = getRouteColor(train.routeId);
      const direction = getDirectionFromStopId(train.nextStopId);

      // Use new motion-based system if enabled and utilities loaded
      if (useAlphaBetaGamma && trackUtilsLoaded.current && getRouteTrack && getStopArclength) {
        const existingMotion = trainMotionRef.current.get(train.tripId);

        if (existingMotion) {
          // Calculate scheduled duration from GTFS matrix
          let scheduledDuration = 90;
          if (durationMatrix && getSegmentDuration) {
            const duration = getSegmentDuration(
              durationMatrix,
              train.routeId,
              existingMotion.prevStopId,
              existingMotion.nextStopId
            );
            if (duration) {
              scheduledDuration = duration;
            }
          }

          // Calculate speed multiplier from API timing (NOT alerts)
          const apiDuration = ((train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs)) / 1000;
          const speedMultiplier = apiDuration > 0 ? scheduledDuration / apiDuration : 1.0;

          // Update state machine with duration and speed
          if (existingMotion.animState && trainAnimationReducer) {
            existingMotion.animState = trainAnimationReducer(existingMotion.animState, {
              type: 'SET_DURATION',
              duration: scheduledDuration
            });
            existingMotion.animState = trainAnimationReducer(existingMotion.animState, {
              type: 'SET_SPEED_MULTIPLIER',
              multiplier: speedMultiplier
            });
          }

          // Update motion state with new API data
          await updateMotionState(existingMotion, train, nowMs);

          // Pass current arclength and next station arclength for distance-based phase
          existingMotion.popup.setHTML(createPopupHTML(train, color, existingMotion.filter.s, existingMotion.nextS));

          // Apply clustering offset for overlapping trains
          const offset = trainOffsets.get(train.tripId);
          if (offset) {
            existingMotion.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        } else {
          // Calculate duration and speed for new train
          let scheduledDuration = 90;
          if (durationMatrix && getSegmentDuration && train.prevStopId) {
            const duration = getSegmentDuration(
              durationMatrix,
              train.routeId,
              train.prevStopId,
              train.nextStopId
            );
            if (duration) {
              scheduledDuration = duration;
            }
          }

          const apiDuration = ((train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs)) / 1000;
          const speedMultiplier = apiDuration > 0 ? scheduledDuration / apiDuration : 1.0;

          // Create new motion state with duration and speed
          const motionState = await createMotionState(
            train, map, color, direction, nowMs, setSelectedTrain,
            durationMatrix, scheduledDuration, speedMultiplier
          );
          if (motionState) {
            trainMotionRef.current.set(train.tripId, motionState);
            // Apply clustering offset for overlapping trains
            const offset = trainOffsets.get(train.tripId);
            if (offset) {
              motionState.marker.setOffset([offset.offsetX, offset.offsetY]);
            }
          } else {
            // Fallback to legacy if track not found
            // Make sure we're not duplicating - clean up motion ref if it exists
            trainMotionRef.current.delete(train.tripId);
            // Only create legacy marker if it doesn't already exist
            if (!trainAnimsRef.current.has(train.tripId)) {
              createLegacyMarker(train, map, color, direction, now, trainAnimsRef, setSelectedTrain);
              // Apply clustering offset for overlapping trains
              const legacyAnim = trainAnimsRef.current.get(train.tripId);
              const offset = trainOffsets.get(train.tripId);
              if (legacyAnim && offset) {
                legacyAnim.marker.setOffset([offset.offsetX, offset.offsetY]);
              }
            }
          }
        }
      } else {
        // Use legacy animation system
        const existingAnim = trainAnimsRef.current.get(train.tripId);

        if (existingAnim) {
          // Update existing animation
          const elapsed = now - existingAnim.startTime;
          const progress = Math.min(elapsed / refreshInterval, 1);

          const currentLng = lerp(existingAnim.fromLng, existingAnim.toLng, progress);
          const currentLat = lerp(existingAnim.fromLat, existingAnim.toLat, progress);

          const distance = getDistance(currentLng, currentLat, train.lon, train.lat);
          const isDwelling = distance < MAP_CONSTANTS.DWELLING_THRESHOLD;

          existingAnim.fromLng = currentLng;
          existingAnim.fromLat = currentLat;
          existingAnim.toLng = train.lon;
          existingAnim.toLat = train.lat;
          existingAnim.startTime = now;
          existingAnim.isDwelling = isDwelling;
          existingAnim.nextStopName = train.nextStopName;
          existingAnim.eta = train.eta;
          existingAnim.direction = direction;

          existingAnim.popup.setHTML(createPopupHTML(train, color));

          // Apply clustering offset for overlapping trains
          const offset = trainOffsets.get(train.tripId);
          if (offset) {
            existingAnim.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        } else {
          createLegacyMarker(train, map, color, direction, now, trainAnimsRef, setSelectedTrain);
          // Apply clustering offset for overlapping trains
          const legacyAnim = trainAnimsRef.current.get(train.tripId);
          const offset = trainOffsets.get(train.tripId);
          if (legacyAnim && offset) {
            legacyAnim.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        }
      }
    });

    // Restart animation loop
    scheduleAnimation();
  }, [mapLoaded, map, trains, selectedRouteIds, lerp, getDistance, refreshInterval, selectedTrainId, setSelectedTrain, trainAnimsRef, trainMotionRef, scheduleAnimation, useAlphaBetaGamma, durationMatrix, alerts, fadeOutAndRemove]);

  // Cleanup fading markers on unmount to prevent memory leaks from pending timeouts
  useEffect(() => {
    const fadingOut = fadingOutRef.current;
    return () => {
      fadingOut.forEach(({ timeoutId, marker }) => {
        clearTimeout(timeoutId);
        marker.remove();
      });
      fadingOut.clear();
    };
  }, []);

  // Memoize visible train count (subtract deduped trains)
  // Replicates the dedup grouping logic to count exclusions without accessing refs during render
  const visibleTrainCount = useMemo(() => {
    const filteredTrains = selectedRouteIds.length === 0
      ? trains
      : trains.filter((t) => selectedRouteIds.includes(t.routeId.toUpperCase()));

    // Count unique dedup keys — each key keeps one train, rest are excluded
    const dedupKeys = new Set<string>();
    for (const train of filteredTrains) {
      dedupKeys.add(`${train.routeId}:${train.prevStopId ?? ''}:${train.nextStopId}`);
    }

    return dedupKeys.size;
  }, [trains, selectedRouteIds]);

  // Get current phase for a train from motion state
  const getTrainPhase = useCallback((tripId: string): 'BOARDING' | 'ARRIVING' | 'APPROACHING' | null => {
    const motionState = trainMotionRef.current.get(tripId);
    if (!motionState) return null;
    return motionState.lastPhase || getPhaseFromDistance(motionState.filter.s, motionState.nextS);
  }, [trainMotionRef]);

  return { visibleTrainCount, latestApiDataRef, getTrainPhase };
}

/**
 * Creates a new motion-based train state for arclength-based animation.
 *
 * This function initializes a train's animation state using the alpha-beta-gamma
 * filter for smooth position interpolation along the route track. It calculates
 * the initial arclength position from GTFS schedule data and creates the marker
 * and popup UI elements.
 *
 * @param train - Train position data from MTA API
 * @param map - MapLibre GL map instance
 * @param color - Route color for the marker
 * @param direction - Travel direction ('N' for northbound, 'S' for southbound)
 * @param nowMs - Current timestamp in milliseconds
 * @param setSelectedTrain - Callback to set the selected train in UI state
 * @param durationMatrix - Pre-computed GTFS schedule durations (optional)
 * @param scheduledDuration - Expected travel time for current segment (seconds)
 * @param speedMultiplier - Speed adjustment factor (>1 = faster than scheduled)
 * @returns TrainMotionState for animation, or null if track data unavailable
 *
 * @remarks
 * - Returns null if route track or stop arclengths cannot be resolved
 * - Falls back to legacy animation system when this returns null
 * - State machine is currently DISABLED due to BOARDING phase bug
 */
async function createMotionState(
  train: TrainPosition,
  map: maplibregl.Map,
  color: string,
  direction: 'N' | 'S' | null,
  nowMs: number,
  setSelectedTrain: (tripId: string | null) => void,
  durationMatrix: RouteDurationMatrix | null,
  scheduledDuration: number,
  speedMultiplier: number
): Promise<TrainMotionState | null> {
  if (!getRouteTrack || !getStopArclength || !createFilterState) return null;

  // Get track for this route
  const track = await getRouteTrack(train.routeId);
  if (!track) return null;

  // Get arclengths for prev and next stops
  const prevS = train.prevStopId ? await getStopArclength(train.routeId, train.prevStopId) : undefined;
  const nextS = await getStopArclength(train.routeId, train.nextStopId);

  if (prevS === undefined || nextS === undefined) return null;

  // Calculate initial position from schedule
  const prevTimeMs = train.prevTimeMs || nowMs - refreshInterval;
  const nextTimeMs = train.nextTimeMs || nowMs + refreshInterval;
  const totalTime = nextTimeMs - prevTimeMs;
  const elapsed = nowMs - prevTimeMs;
  const progress = totalTime > 0 ? Math.max(0, Math.min(1, elapsed / totalTime)) : 0;
  const initialS = prevS + (nextS - prevS) * progress;

  // Create marker element
  const el = document.createElement('div');
  el.className = 'train-marker';
  el.style.cssText = `
    width: 22px;
    height: 22px;
    background-color: ${color};
    border: 2px solid white;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: bold;
    color: ${getTextColorForBackground(color)};
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    cursor: pointer;
    opacity: 0;
  `;
  el.textContent = train.routeId;
  requestAnimationFrame(() => { el.style.opacity = '1'; });

  // Create popup with distance-based phase
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: MAP_CONSTANTS.POPUP_OFFSET_TRAIN,
    className: 'train-popup',
  }).setHTML(createPopupHTML(train, color, initialS, nextS));

  // Create marker
  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([train.lon, train.lat])
    .addTo(map);

  // Event handlers
  el.addEventListener('mouseenter', () => {
    marker.setPopup(popup).togglePopup();
  });
  el.addEventListener('mouseleave', () => {
    popup.remove();
  });
  el.addEventListener('click', () => {
    const currentSelectedId = useUIStore.getState().selectedTrainId;
    setSelectedTrain(train.tripId === currentSelectedId ? null : train.tripId);
  });

  // DISABLED: State machine causes trains to get stuck in BOARDING phase
  // Using fallback lerp animation instead (see useMapAnimation.ts:220-241)
  const animState = null;

  // Calculate initial phase from distance
  const initialPhase = getPhaseFromDistance(initialS, nextS);

  // Using schedule-based animation with duration matrix
  return {
    tripId: train.tripId,
    routeId: train.routeId,
    marker,
    popup,
    track,
    filter: createFilterState(initialS, 0, 0, nowMs),
    plan: null,
    prevStopId: train.prevStopId || '',
    nextStopId: train.nextStopId,
    prevTimeMs,
    nextTimeMs,
    prevS,
    nextS,
    // Schedule-based animation fields (deprecated - use animState)
    segmentStartTime: nowMs - elapsed,
    scheduledDuration,
    speedMultiplier,
    // State machine
    animState,
    nextStopName: train.nextStopName,
    eta: train.eta,
    headsign: train.headsign,
    direction,
    lastFrameTime: performance.now(),
    lastRenderedS: initialS,
    lastApiUpdate: nowMs,
    // Phase tracking for popup updates during animation
    lastPhase: initialPhase
  };
}

/**
 * Updates an existing motion state with new API data.
 *
 * This function handles segment transitions gracefully to avoid visual "snapping".
 * When a train moves to a new segment (different prev/next stop pair), the behavior
 * depends on whether the train has reached the current station:
 *
 * **At station (within 20m)**: Queue the new segment and start dwell timer.
 * The train will pause briefly before departing to the next station.
 *
 * **Not at station**: Update segment immediately to keep the train moving.
 * This prevents trains from getting stuck mid-segment.
 *
 * @param state - Existing motion state to update
 * @param train - New train position data from MTA API
 * @param nowMs - Current timestamp in milliseconds
 *
 * @remarks
 * - Dispatches API_UPDATE to state machine if enabled
 * - Updates filter state, timing data, and display info
 * - Pending segments are consumed by the animation loop after dwell completes
 *
 * @see STATION_SNAP_DISTANCE - 20m threshold for "at station" detection
 */
async function updateMotionState(
  state: TrainMotionState,
  train: TrainPosition,
  nowMs: number
): Promise<void> {
  if (!getStopArclength) return;

  // Get new arclengths
  const resolvedPrevS = train.prevStopId
    ? await getStopArclength(train.routeId, train.prevStopId)
    : undefined;
  const prevS = resolvedPrevS ?? state.prevS;
  const nextS = await getStopArclength(train.routeId, train.nextStopId);

  if (nextS === undefined) return;

  // Calculate API progress
  const totalTime = (train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs);
  const elapsed = nowMs - (train.prevTimeMs || nowMs);
  const apiProgress = totalTime > 0 ? Math.max(0, Math.min(1, elapsed / totalTime)) : 0;

  // CRITICAL: Dispatch API_UPDATE to state machine (if using state machine)
  if (state.animState && trainAnimationReducer && prevS !== undefined) {
    state.animState = trainAnimationReducer(state.animState, {
      type: 'API_UPDATE',
      nowMs,
      prevStopId: train.prevStopId || '',
      nextStopId: train.nextStopId,
      prevS,
      nextS,
      apiProgress
    });
  }

  // Detect segment change (train moved to new station pair)
  const segmentChanged =
    train.prevStopId !== state.prevStopId ||
    train.nextStopId !== state.nextStopId;

  if (segmentChanged && prevS !== undefined) {
    // Check if train has already reached current station
    const distanceToCurrentStation = Math.abs(state.nextS - state.filter.s);
    const atStation = distanceToCurrentStation <= STATION_SNAP_DISTANCE;

    // Calculate duration from API timing (or use default)
    const apiDurationMs = (train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs);
    const newScheduledDuration = apiDurationMs > 0 ? apiDurationMs / 1000 : 90;

    if (atStation) {
      // Train is at station - queue segment and start dwell
      if (Number.isFinite(prevS) && Number.isFinite(nextS)) {
        state.pendingSegment = {
          prevStopId: train.prevStopId || '',
          nextStopId: train.nextStopId,
          prevS: prevS,
          nextS: nextS,
          scheduledDuration: newScheduledDuration,
          nextStopName: train.nextStopName,
          eta: train.eta,
        };
        if (!state.dwellStartTime) {
          state.dwellStartTime = nowMs;
        }
      }
    } else {
      // Train NOT at station - immediately update segment to keep moving
      // This prevents trains from getting stuck
      if (Number.isFinite(prevS) && Number.isFinite(nextS)) {
        state.prevStopId = train.prevStopId || '';
        state.nextStopId = train.nextStopId;
        state.prevS = prevS;
        state.nextS = nextS;
        state.scheduledDuration = newScheduledDuration;
        state.nextStopName = train.nextStopName;
        state.eta = train.eta;
        // Calculate segmentStartTime from current rendered position
        const segmentRange = nextS - prevS;
        const segmentDurationMs = newScheduledDuration * 1000;
        if (Math.abs(segmentRange) > 0 && segmentDurationMs > 0) {
          const positionInSegment = (state.filter.s - prevS) / segmentRange;
          const clampedProgress = Math.max(0, Math.min(1, positionInSegment));
          state.segmentStartTime = nowMs - (clampedProgress * segmentDurationMs);
        } else {
          state.segmentStartTime = nowMs;
        }
        // Clear any pending since we just updated directly
        state.pendingSegment = undefined;
        state.dwellStartTime = undefined;
      }
      // else: skip — don't corrupt state with bad arclengths
    }
  }

  // Update display info
  state.prevTimeMs = train.prevTimeMs || state.prevTimeMs;
  state.nextTimeMs = train.nextTimeMs || state.nextTimeMs;
  state.headsign = train.headsign;
  state.lastApiUpdate = nowMs;

  // Update display data if no pending segment
  if (!state.pendingSegment) {
    state.nextStopName = train.nextStopName;
    state.eta = train.eta;
  }
}

/**
 * Creates a legacy marker using direct lat/lng animation.
 *
 * This is the fallback animation system used when:
 * - Route track data is not available
 * - Alpha-beta-gamma system is disabled
 * - createMotionState() returns null
 *
 * Uses simple linear interpolation between API-provided coordinates instead
 * of arclength-based animation along the route track.
 *
 * @param train - Train position data from MTA API
 * @param map - MapLibre GL map instance
 * @param color - Route color for the marker
 * @param direction - Travel direction ('N' for northbound, 'S' for southbound)
 * @param now - Current timestamp from performance.now()
 * @param trainAnimsRef - Ref holding all legacy animation states
 * @param setSelectedTrain - Callback to set the selected train in UI state
 */
function createLegacyMarker(
  train: TrainPosition,
  map: maplibregl.Map,
  color: string,
  direction: 'N' | 'S' | null,
  now: number,
  trainAnimsRef: React.MutableRefObject<Map<string, TrainAnimState>>,
  setSelectedTrain: (tripId: string | null) => void
): void {
  const el = document.createElement('div');
  el.className = 'train-marker';
  el.style.cssText = `
    width: 22px;
    height: 22px;
    background-color: ${color};
    border: 2px solid white;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: bold;
    color: ${getTextColorForBackground(color)};
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    cursor: pointer;
    opacity: 0;
  `;
  el.textContent = train.routeId;
  requestAnimationFrame(() => { el.style.opacity = '1'; });

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: MAP_CONSTANTS.POPUP_OFFSET_TRAIN,
    className: 'train-popup',
  }).setHTML(createPopupHTML(train, color));

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([train.lon, train.lat])
    .addTo(map);

  el.addEventListener('mouseenter', () => {
    marker.setPopup(popup).togglePopup();
  });
  el.addEventListener('mouseleave', () => {
    popup.remove();
  });
  el.addEventListener('click', () => {
    const currentSelectedId = useUIStore.getState().selectedTrainId;
    setSelectedTrain(train.tripId === currentSelectedId ? null : train.tripId);
  });

  trainAnimsRef.current.set(train.tripId, {
    marker,
    popup,
    fromLng: train.lon,
    fromLat: train.lat,
    toLng: train.lon,
    toLat: train.lat,
    startTime: now,
    isDwelling: false,
    routeId: train.routeId,
    nextStopName: train.nextStopName,
    eta: train.eta,
    direction,
  });
}

/**
 * Distance thresholds for train phase detection (in meters).
 * These match the values in train-state-machine.ts.
 */
const ARRIVING_DISTANCE = 200;  // Show "Arriving" when within 200m of station
const STATION_SNAP_DISTANCE = 20;  // Show "At Station" when within 20m

/**
 * Determines the current phase of a train based on its distance to the next station.
 *
 * @param currentS - Current arclength position of the train (meters from route start)
 * @param nextS - Arclength position of the next station (meters from route start)
 * @returns The train phase:
 *   - 'BOARDING': Within 20m of station (displays as "At Station")
 *   - 'ARRIVING': Within 200m of station (displays as "Arriving")
 *   - 'APPROACHING': More than 200m from station (displays as "En Route")
 *
 * @example
 * ```ts
 * const phase = getPhaseFromDistance(1500, 1510);  // 10m away -> 'BOARDING'
 * const phase = getPhaseFromDistance(1500, 1650);  // 150m away -> 'ARRIVING'
 * const phase = getPhaseFromDistance(1500, 2000);  // 500m away -> 'APPROACHING'
 * ```
 */
function getPhaseFromDistance(currentS: number, nextS: number): 'BOARDING' | 'ARRIVING' | 'APPROACHING' {
  const distance = Math.abs(nextS - currentS);
  if (distance <= STATION_SNAP_DISTANCE) return 'BOARDING';
  if (distance <= ARRIVING_DISTANCE) return 'ARRIVING';
  return 'APPROACHING';
}

/**
 * Creates HTML content for train popup tooltip.
 *
 * Displays train route, destination, next station, and current phase.
 * Phase is determined using distance-based detection when arclength data
 * is available, with ETA-based fallback for legacy trains.
 *
 * **Phase detection priority:**
 * 1. Distance-based (preferred): Uses currentS/nextS arclength positions
 * 2. ETA-based (fallback): Parses train.eta for legacy trains
 *
 * **Phase display mapping:**
 * - BOARDING (≤20m) → "At Station" (amber)
 * - ARRIVING (≤200m) → "Arriving" (green)
 * - APPROACHING (>200m) → "En Route · ETA" (light green)
 *
 * @param train - Train position data from MTA API
 * @param color - Route color for visual badge
 * @param currentS - Current arclength position (meters from route start)
 * @param nextS - Next station arclength position (meters from route start)
 * @returns HTML string for MapLibre popup
 */
function createPopupHTML(train: TrainPosition, color: string, currentS?: number, nextS?: number): string {
  const direction = getDirectionFromStopId(train.nextStopId);
  const destinationLabel = train.headsign || getDirectionLabel(direction);

  // Calculate phase from DISTANCE if available (preferred), otherwise fallback to ETA
  let derivedPhase: string | undefined;

  if (currentS !== undefined && nextS !== undefined) {
    // Distance-based phase detection (reliable)
    const distanceToStation = Math.abs(nextS - currentS);
    if (distanceToStation <= STATION_SNAP_DISTANCE) {
      derivedPhase = 'BOARDING';
    } else if (distanceToStation <= ARRIVING_DISTANCE) {
      derivedPhase = 'ARRIVING';
    } else {
      derivedPhase = 'APPROACHING';
    }
  } else if (train.eta) {
    // Fallback to ETA for legacy trains without arclength data
    try {
      const etaDate = new Date(train.eta);
      if (!isNaN(etaDate.getTime())) {
        const diffMs = etaDate.getTime() - Date.now();
        const diffMins = Math.round(diffMs / 60000);
        if (diffMins <= 0) {
          derivedPhase = 'BOARDING';
        } else if (diffMins === 1) {
          derivedPhase = 'ARRIVING';
        } else {
          derivedPhase = 'APPROACHING';
        }
      }
    } catch {
      derivedPhase = 'APPROACHING';
    }
  }

  // Format phase for display
  const phaseColor = derivedPhase === 'BOARDING' ? '#f59e0b' :
                     derivedPhase === 'ARRIVING' ? '#22c55e' : '#4ade80';

  return `
    <div style="padding: 8px 12px; background: #1a1a1a; border-radius: 6px; min-width: 160px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <div style="
          width: 24px;
          height: 24px;
          background-color: ${color};
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: bold;
          color: ${getTextColorForBackground(color)};
        ">${train.routeId}</div>
        <span style="color: #888; font-size: 12px;">${destinationLabel}</span>
      </div>
      <div style="color: white; font-size: 13px; margin-bottom: 4px;">
        <strong>Next:</strong> ${train.nextStopName || 'Unknown'}
      </div>
      <div style="color: ${phaseColor}; font-size: 13px; font-weight: 600;">
        ${derivedPhase === 'BOARDING' ? 'At Station' :
          derivedPhase === 'ARRIVING' ? 'Arriving' :
          'En Route · ' + formatEta(train.eta)}
      </div>
    </div>
  `;
}

// Module-level constant for refresh interval fallback
const refreshInterval = 15000;
