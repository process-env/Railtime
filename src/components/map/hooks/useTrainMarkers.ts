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
import { getDirectionFromStopId, getTextColorForBackground } from '@/lib/mta/format';
import { buildTrainPopupHTML } from '@/components/map/utils/popup';
import { useUIStore } from '@/stores';
import { calculateTrainOffsets, type TrainWithPosition } from '@/lib/map/cluster-trains';
import type { TrainPosition, ServiceAlert } from '@/types/mta';
import type { TrainAnimState, TrainMotionState, UnifiedMarkerState } from './useMapAnimation';
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

// Route terminals: first and last stop for each route+direction
type RouteTerminals = Map<string, Record<string, { first: string; last: string }>>;
let routeTerminals: RouteTerminals | null = null;

async function loadRouteTerminals(): Promise<RouteTerminals> {
  if (routeTerminals) return routeTerminals;
  const res = await fetch('/data/route-segments.json');
  const data = await res.json();
  routeTerminals = new Map();
  for (const [routeId, routeData] of Object.entries(data.routes as Record<string, { directions: Record<string, { stops: string[] }> }>)) {
    const dirs: Record<string, { first: string; last: string }> = {};
    for (const [dirId, dirData] of Object.entries(routeData.directions)) {
      const stops = dirData.stops;
      if (stops.length > 0) {
        dirs[dirId] = { first: stops[0], last: stops[stops.length - 1] };
      }
    }
    routeTerminals.set(routeId, dirs);
  }
  return routeTerminals;
}

function baseStopId(stopId: string): string {
  if (!stopId) return '';
  const last = stopId.slice(-1);
  return (last === 'N' || last === 'S') ? stopId.slice(0, -1) : stopId;
}

function directionIdFromSuffix(stopId: string): string | null {
  const last = stopId.slice(-1);
  if (last === 'N') return '0';
  if (last === 'S') return '1';
  return null;
}

function isAtFirstStop(routeId: string, prevStopId: string): boolean {
  if (!routeTerminals || !prevStopId) return false;
  const dirs = routeTerminals.get(routeId);
  if (!dirs) return false;
  const dirId = directionIdFromSuffix(prevStopId);
  if (dirId && dirs[dirId]) {
    return baseStopId(prevStopId) === dirs[dirId].first;
  }
  // No direction suffix — don't block (better to show than wrongly hide)
  return false;
}

function isAtLastStop(routeId: string, nextStopId: string): boolean {
  if (!routeTerminals || !nextStopId) return false;
  const dirs = routeTerminals.get(routeId);
  if (!dirs) return false;
  const dirId = directionIdFromSuffix(nextStopId);
  if (dirId && dirs[dirId]) {
    return baseStopId(nextStopId) === dirs[dirId].last;
  }
  // Fallback: check both directions
  return Object.values(dirs).some(d => d.last === baseStopId(nextStopId));
}

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

const STALE_DIM_MS = 120_000;    // 2 min — dim to 0.4 opacity
const STALE_CULL_MS = 600_000;   // 10 min — hard cull (ghost train)

const FADE_DURATION_MS = 300;

interface FadingMarker {
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;
  timeoutId: ReturnType<typeof setTimeout>;
  unifiedState: UnifiedMarkerState;
}

/**
 * Hook to manage train markers with smooth animation
 */
export function useTrainMarkers(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  trainMarkersRef: React.MutableRefObject<Map<string, UnifiedMarkerState>>,
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

  // Generation counter for cancelling stale async marker processing
  const processingGenRef = useRef(0);

  // Load track utilities on mount
  useEffect(() => {
    if (useAlphaBetaGamma) {
      Promise.all([loadTrackUtils(), loadRouteTerminals()]).then(() => {
        trackUtilsLoaded.current = true;
        forceUpdate(n => n + 1);
      });
    }
  }, [useAlphaBetaGamma]);

  // Update latestApiDataRef whenever trains change (for animation loop to read)
  useEffect(() => {
    if (!trackUtilsLoaded.current || !getStopArclength) return;

    let cancelled = false;

    const updateApiData = async () => {
      const nowMs = Date.now();

      for (const train of trains) {
        // Get arclengths for this train's segment
        const prevS = train.prevStopId
          ? await getStopArclength!(train.routeId, train.prevStopId)
          : undefined;
        if (cancelled) return;

        const nextS = await getStopArclength!(train.routeId, train.nextStopId);
        if (cancelled) return;

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

      if (cancelled) return;

      // Clean up old entries
      const currentTripIds = new Set(trains.map(t => t.tripId));
      latestApiDataRef.current.forEach((_, tripId) => {
        if (!currentTripIds.has(tripId)) {
          latestApiDataRef.current.delete(tripId);
        }
      });
    };

    updateApiData();
    return () => { cancelled = true; };
  }, [trains]);

  // Helper to calculate distance between two points
  const getDistance = useCallback((lng1: number, lat1: number, lng2: number, lat2: number) => {
    return Math.sqrt(Math.pow(lng2 - lng1, 2) + Math.pow(lat2 - lat1, 2));
  }, []);

  // Fade out a marker over FADE_DURATION_MS, then remove it from the DOM
  const fadeOutAndRemove = useCallback((
    tripId: string,
    unifiedState: UnifiedMarkerState
  ) => {
    if (fadingOutRef.current.has(tripId)) return; // Already fading

    unifiedState.marker.getElement().style.opacity = '0';
    unifiedState.popup.remove();

    const timeoutId = setTimeout(() => {
      // Remove event listeners before removing marker from DOM
      if (unifiedState.cleanupListeners) unifiedState.cleanupListeners();
      unifiedState.marker.remove();
      fadingOutRef.current.delete(tripId);
    }, FADE_DURATION_MS);

    fadingOutRef.current.set(tripId, { marker: unifiedState.marker, popup: unifiedState.popup, timeoutId, unifiedState });
  }, []);

  // Update train markers
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;

    // Increment generation to cancel stale async chains from previous renders
    const generation = ++processingGenRef.current;

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

    // Remove old markers using entry/exit gate model (unified loop):
    // - Route filtered out → remove immediately
    // - At last stop → fade out (service complete)
    // - Mid-route → staleness gradient (dim → cull)
    trainMarkersRef.current.forEach((entry, tripId) => {
      if (!currentTripIds.has(tripId)) {
        const routeFilterActive = selectedRouteIds.length > 0;
        const trainRouteMatchesFilter = selectedRouteIds.includes(entry.routeId?.toUpperCase() || '');
        const isFilteredOut = routeFilterActive && !trainRouteMatchesFilter;

        if (isFilteredOut) {
          fadeOutAndRemove(tripId, entry);
          trainMarkersRef.current.delete(tripId);
        } else if (isAtLastStop(entry.routeId, entry.type === 'motion' ? entry.api.nextStopId : entry.nextStopId)) {
          fadeOutAndRemove(tripId, entry);
          trainMarkersRef.current.delete(tripId);
        } else {
          // Mid-route — staleness gradient
          const timeSinceUpdate = entry.type === 'motion'
            ? nowMs - entry.api.lastApiUpdate
            : nowMs - (entry.startTime || 0);
          if (timeSinceUpdate > STALE_CULL_MS) {
            fadeOutAndRemove(tripId, entry);
            trainMarkersRef.current.delete(tripId);
          } else if (timeSinceUpdate > STALE_DIM_MS) {
            entry.marker.getElement().style.opacity = '0.4';
          }
        }
      } else {
        // Train is ACTIVE in API — restore full opacity if dimmed
        const el = entry.marker.getElement();
        if (el.style.opacity === '0.4') {
          el.style.opacity = '1';
        }
      }
    });

    // Process each train
    void Promise.all(displayTrains.map(async (train) => {
      // Bail out if a newer effect has started (stale async chain)
      if (generation !== processingGenRef.current) return;

      // If this train is mid-fade-out, cancel the fade and restore it
      const fading = fadingOutRef.current.get(train.tripId);
      if (fading) {
        clearTimeout(fading.timeoutId);
        fadingOutRef.current.delete(train.tripId);
        fading.marker.getElement().style.opacity = '1';
        // Restore to unified map so the existing-marker check below finds it
        trainMarkersRef.current.set(train.tripId, fading.unifiedState);
      }

      // Entry gate: don't show trains that haven't left their first station
      // Only gates NEW markers — existing on-track trains are never affected
      if (!trainMarkersRef.current.has(train.tripId)) {
        if (isAtFirstStop(train.routeId, train.prevStopId ?? '')) {
          return; // Skip — train hasn't departed first station (use return not continue since we're in forEach)
        }
      }

      const color = getRouteColor(train.routeId);
      const direction = getDirectionFromStopId(train.nextStopId);

      // Use new motion-based system if enabled and utilities loaded
      if (useAlphaBetaGamma && trackUtilsLoaded.current && getRouteTrack && getStopArclength) {
        const existingEntry = trainMarkersRef.current.get(train.tripId);
        const existingMotion = existingEntry?.type === 'motion' ? existingEntry : undefined;

        if (existingMotion) {
          // Calculate scheduled duration from GTFS matrix
          let scheduledDuration = 90;
          if (durationMatrix && getSegmentDuration) {
            const duration = getSegmentDuration(
              durationMatrix,
              train.routeId,
              existingMotion.api.prevStopId,
              existingMotion.api.nextStopId
            );
            if (duration) {
              scheduledDuration = duration;
            }
          }

          // Calculate speed multiplier from API timing (NOT alerts)
          const apiDuration = ((train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs)) / 1000;
          const speedMultiplier = apiDuration > 0 ? scheduledDuration / apiDuration : 1.0;

          // Update state machine with duration and speed
          // NOTE: This crosses into animation-owned state from the API effect.
          // The boundary crossing is intentional and made explicit by the sub-object path.
          if (existingMotion.animation.animState && trainAnimationReducer) {
            existingMotion.animation.animState = trainAnimationReducer(existingMotion.animation.animState, {
              type: 'SET_DURATION',
              duration: scheduledDuration
            });
            existingMotion.animation.animState = trainAnimationReducer(existingMotion.animation.animState, {
              type: 'SET_SPEED_MULTIPLIER',
              multiplier: speedMultiplier
            });
          }

          // Update motion state with new API data
          await updateMotionState(existingMotion, train, nowMs);
          if (generation !== processingGenRef.current) return;

          // Pass current arclength and next station arclength for distance-based phase
          existingMotion.popup.setHTML(buildTrainPopupHTML(
            train, color, undefined,
            existingMotion.animation.filter.s, existingMotion.api.nextS
          ));

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
            durationMatrix, scheduledDuration, speedMultiplier, refreshInterval
          );
          if (generation !== processingGenRef.current) {
            // Stale — clean up the marker we just created so it doesn't become a phantom
            if (motionState) {
              motionState.marker.remove();
              motionState.popup.remove();
            }
            return;
          }
          if (motionState) {
            trainMarkersRef.current.set(train.tripId, { type: 'motion', ...motionState });
            // Apply clustering offset for overlapping trains
            const offset = trainOffsets.get(train.tripId);
            if (offset) {
              motionState.marker.setOffset([offset.offsetX, offset.offsetY]);
            }
          } else {
            // Fallback to legacy if track not found
            // Clean up any existing entry for this train
            trainMarkersRef.current.delete(train.tripId);
            // Only create legacy marker if it doesn't already exist
            const existingLegacy = trainMarkersRef.current.get(train.tripId);
            if (!existingLegacy || existingLegacy.type !== 'legacy') {
              createLegacyMarker(train, map, color, direction, now, trainMarkersRef, setSelectedTrain);
              // Apply clustering offset for overlapping trains
              const newEntry = trainMarkersRef.current.get(train.tripId);
              const offset = trainOffsets.get(train.tripId);
              if (newEntry && offset) {
                newEntry.marker.setOffset([offset.offsetX, offset.offsetY]);
              }
            }
          }
        }
      } else {
        // Use legacy animation system
        const existingEntry = trainMarkersRef.current.get(train.tripId);
        const existingAnim = existingEntry?.type === 'legacy' ? existingEntry : undefined;

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
          existingAnim.nextStopId = train.nextStopId;
          existingAnim.nextStopName = train.nextStopName;
          existingAnim.eta = train.eta;
          existingAnim.direction = direction;

          existingAnim.popup.setHTML(buildTrainPopupHTML(train, color));

          // Apply clustering offset for overlapping trains
          const offset = trainOffsets.get(train.tripId);
          if (offset) {
            existingAnim.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        } else {
          createLegacyMarker(train, map, color, direction, now, trainMarkersRef, setSelectedTrain);
          // Apply clustering offset for overlapping trains
          const newEntry = trainMarkersRef.current.get(train.tripId);
          const offset = trainOffsets.get(train.tripId);
          if (newEntry && offset) {
            newEntry.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        }
      }
    })).then(() => {
      // Only schedule animation if this generation is still current
      if (generation === processingGenRef.current) {
        scheduleAnimation();
      }
    });
  }, [mapLoaded, mapRef, trains, selectedRouteIds, lerp, getDistance, refreshInterval, selectedTrainId, setSelectedTrain, trainMarkersRef, scheduleAnimation, useAlphaBetaGamma, durationMatrix, alerts, fadeOutAndRemove]);

  // Cleanup fading markers on unmount to prevent memory leaks from pending timeouts
  useEffect(() => {
    const fadingOut = fadingOutRef.current;
    return () => {
      fadingOut.forEach(({ timeoutId, marker, unifiedState }) => {
        clearTimeout(timeoutId);
        if (unifiedState.cleanupListeners) unifiedState.cleanupListeners();
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
    const entry = trainMarkersRef.current.get(tripId);
    if (!entry || entry.type !== 'motion') return null;
    return entry.animation.lastPhase || getPhaseFromDistance(entry.animation.filter.s, entry.api.nextS);
  }, [trainMarkersRef]);

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
  speedMultiplier: number,
  refreshInterval: number
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
  }).setHTML(buildTrainPopupHTML(train, color, undefined, initialS, nextS));

  // Create marker
  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([train.lon, train.lat])
    .addTo(map);

  // Event handlers — store references for cleanup on marker removal
  const handleMouseEnter = () => {
    marker.setPopup(popup).togglePopup();
  };
  const handleMouseLeave = () => {
    popup.remove();
  };
  const handleClick = () => {
    const currentSelectedId = useUIStore.getState().selectedTrainId;
    setSelectedTrain(train.tripId === currentSelectedId ? null : train.tripId);
  };

  el.addEventListener('mouseenter', handleMouseEnter);
  el.addEventListener('mouseleave', handleMouseLeave);
  el.addEventListener('click', handleClick);

  const cleanupListeners = () => {
    el.removeEventListener('mouseenter', handleMouseEnter);
    el.removeEventListener('mouseleave', handleMouseLeave);
    el.removeEventListener('click', handleClick);
  };

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
    plan: null,
    animation: {
      filter: createFilterState(initialS, 0, 0, nowMs),
      lastFrameTime: performance.now(),
      lastRenderedS: initialS,
      animState,
      lastPhase: initialPhase,
    },
    api: {
      prevStopId: train.prevStopId || '',
      nextStopId: train.nextStopId,
      prevTimeMs,
      nextTimeMs,
      prevS,
      nextS,
      segmentStartTime: nowMs - elapsed,
      scheduledDuration,
      speedMultiplier,
      nextStopName: train.nextStopName,
      eta: train.eta,
      headsign: train.headsign,
      direction,
      lastApiUpdate: nowMs,
    },
    cleanupListeners,
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

  const { animation: anim, api } = state;

  // Get new arclengths
  const resolvedPrevS = train.prevStopId
    ? await getStopArclength(train.routeId, train.prevStopId)
    : undefined;
  const prevS = resolvedPrevS ?? api.prevS;
  const nextS = await getStopArclength(train.routeId, train.nextStopId);

  if (nextS === undefined) return;

  // Calculate API progress
  const totalTime = (train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs);
  const elapsed = nowMs - (train.prevTimeMs || nowMs);
  const apiProgress = totalTime > 0 ? Math.max(0, Math.min(1, elapsed / totalTime)) : 0;

  // CRITICAL: Dispatch API_UPDATE to state machine (if using state machine)
  // NOTE: This crosses into animation-owned state from the API effect.
  if (anim.animState && trainAnimationReducer && prevS !== undefined) {
    anim.animState = trainAnimationReducer(anim.animState, {
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
    train.prevStopId !== api.prevStopId ||
    train.nextStopId !== api.nextStopId;

  if (segmentChanged && prevS !== undefined) {
    // Check if train has already reached current station
    // NOTE: Reading animation-owned filter.s from API effect (explicit boundary crossing)
    const distanceToCurrentStation = Math.abs(api.nextS - anim.filter.s);
    const atStation = distanceToCurrentStation <= STATION_SNAP_DISTANCE;

    // Calculate duration from API timing (or use default)
    const apiDurationMs = (train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs);
    const newScheduledDuration = apiDurationMs > 0 ? apiDurationMs / 1000 : 90;

    if (atStation) {
      // Train is at station - queue segment via pendingSegment message and start dwell
      if (Number.isFinite(prevS) && Number.isFinite(nextS)) {
        anim.pendingSegment = {
          prevStopId: train.prevStopId || '',
          nextStopId: train.nextStopId,
          prevS: prevS,
          nextS: nextS,
          scheduledDuration: newScheduledDuration,
          nextStopName: train.nextStopName,
          eta: train.eta,
        };
        if (!anim.dwellStartTime) {
          anim.dwellStartTime = nowMs;
        }
      }
    } else {
      // Train NOT at station - immediately update segment to keep moving
      // This prevents trains from getting stuck
      if (Number.isFinite(prevS) && Number.isFinite(nextS)) {
        api.prevStopId = train.prevStopId || '';
        api.nextStopId = train.nextStopId;
        api.prevS = prevS;
        api.nextS = nextS;
        api.scheduledDuration = newScheduledDuration;
        api.speedMultiplier = 1.0;
        api.nextStopName = train.nextStopName;
        api.eta = train.eta;
        // Calculate segmentStartTime from current rendered position
        // NOTE: Reading animation-owned filter.s from API effect (explicit boundary crossing)
        const segmentRange = nextS - prevS;
        const segmentDurationMs = newScheduledDuration * 1000;
        if (Math.abs(segmentRange) > 0 && segmentDurationMs > 0) {
          const positionInSegment = (anim.filter.s - prevS) / segmentRange;
          const clampedProgress = Math.max(0, Math.min(1, positionInSegment));
          api.segmentStartTime = nowMs - (clampedProgress * segmentDurationMs);
        } else {
          api.segmentStartTime = nowMs;
        }
        // Clear any pending since we just updated directly
        anim.pendingSegment = undefined;
        anim.dwellStartTime = undefined;
      }
      // else: skip — don't corrupt state with bad arclengths
    }
  }

  // Update display info
  api.prevTimeMs = train.prevTimeMs || api.prevTimeMs;
  api.nextTimeMs = train.nextTimeMs || api.nextTimeMs;
  api.headsign = train.headsign;
  api.lastApiUpdate = nowMs;

  // Update display data if no pending segment
  if (!anim.pendingSegment) {
    api.nextStopName = train.nextStopName;
    api.eta = train.eta;
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
 * @param trainMarkersRef - Ref holding unified marker states
 * @param setSelectedTrain - Callback to set the selected train in UI state
 */
function createLegacyMarker(
  train: TrainPosition,
  map: maplibregl.Map,
  color: string,
  direction: 'N' | 'S' | null,
  now: number,
  trainMarkersRef: React.MutableRefObject<Map<string, UnifiedMarkerState>>,
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
  }).setHTML(buildTrainPopupHTML(train, color));

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([train.lon, train.lat])
    .addTo(map);

  // Event handlers — store references for cleanup on marker removal
  const handleMouseEnter = () => {
    marker.setPopup(popup).togglePopup();
  };
  const handleMouseLeave = () => {
    popup.remove();
  };
  const handleClick = () => {
    const currentSelectedId = useUIStore.getState().selectedTrainId;
    setSelectedTrain(train.tripId === currentSelectedId ? null : train.tripId);
  };

  el.addEventListener('mouseenter', handleMouseEnter);
  el.addEventListener('mouseleave', handleMouseLeave);
  el.addEventListener('click', handleClick);

  const cleanupListeners = () => {
    el.removeEventListener('mouseenter', handleMouseEnter);
    el.removeEventListener('mouseleave', handleMouseLeave);
    el.removeEventListener('click', handleClick);
  };

  trainMarkersRef.current.set(train.tripId, {
    type: 'legacy',
    marker,
    popup,
    fromLng: train.lon,
    fromLat: train.lat,
    toLng: train.lon,
    toLat: train.lat,
    startTime: now,
    isDwelling: false,
    routeId: train.routeId,
    nextStopId: train.nextStopId,
    nextStopName: train.nextStopName,
    eta: train.eta,
    direction,
    cleanupListeners,
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

// Train popup HTML is now generated by the shared buildTrainPopupHTML utility
// in src/components/map/utils/popup.ts to avoid duplication with useMapAnimation.

