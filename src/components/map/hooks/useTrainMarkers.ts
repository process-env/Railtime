/**
 * useTrainMarkers - Manage train markers with schedule-based animation
 *
 * Handles:
 * - Marker creation/removal based on API data
 * - Motion state initialization with duration matrix
 * - Alert-based speed modulation
 * - Segment change detection and hybrid sync
 */

import { useEffect, useCallback, useRef, useReducer } from 'react';
import maplibregl from 'maplibre-gl';
import { getRouteColor, MAP_CONSTANTS } from '@/lib/constants';
import { getDirectionFromStopId, getTextColorForBackground } from '@/lib/mta/format';
import { routeMatchesFilter } from '@/lib/mta/route-matching';
import { buildTrainPopupHTML } from '@/components/map/utils/popup';
import { useUIStore } from '@/stores';
import { calculateTrainOffsets, type TrainWithPosition } from '@/lib/map/cluster-trains';
import { trainMarkerReducer, createInitialState } from './trainMarkerReducer';
import type { TrainMarkerState } from './trainMarkerReducer';
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

  const [state, dispatch] = useReducer(trainMarkerReducer, undefined, createInitialState);
  const stateRef = useRef<TrainMarkerState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Ref to hold latest API data for animation loop (no re-render on update)
  const latestApiDataRef = useRef<Map<string, ApiDataEntry>>(new Map());

  // Track markers that are mid-fade-out so we can cancel if train reappears
  const fadingOutRef = useRef(new Map<string, FadingMarker>());

  // Generation counter for cancelling stale async marker processing
  const processingGenRef = useRef(0);

  // Effect 1: Load track utilities on mount
  useEffect(() => {
    if (useAlphaBetaGamma) {
      Promise.all([loadTrackUtils(), loadRouteTerminals()]).then(() => {
        dispatch({ type: 'TRACK_UTILS_LOADED' });
      });
    }
  }, [useAlphaBetaGamma]);

  // Effect 2: Filter changed — guarded against reference-only changes
  const prevFilterRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevFilterRef.current;
    if (
      prev.length === selectedRouteIds.length &&
      prev.every((id, i) => id === selectedRouteIds[i])
    ) {
      return; // Same content — skip dispatch to avoid infinite re-render
    }
    prevFilterRef.current = selectedRouteIds;
    dispatch({ type: 'FILTER_CHANGED', selectedRouteIds });
  }, [selectedRouteIds]);

  // Effect 3: Sync trains (dispatch to reducer)
  // Pre-filter: at each terminal, keep only the lead train (soonest departure).
  // Queued trains (2nd–Nth) stack visually and add no information.
  useEffect(() => {
    if (trains.length === 0) return;

    // Group trains sitting at their first stop by route+direction
    const firstStopGroups = new Map<string, TrainPosition[]>();
    const passThroughTrains: TrainPosition[] = [];

    for (const train of trains) {
      if (isAtFirstStop(train.routeId, train.prevStopId ?? '')) {
        const dirId = directionIdFromSuffix(train.prevStopId ?? '');
        const key = `${train.routeId}-${dirId}`;
        let group = firstStopGroups.get(key);
        if (!group) {
          group = [];
          firstStopGroups.set(key, group);
        }
        group.push(train);
      } else {
        passThroughTrains.push(train);
      }
    }

    // From each terminal group, keep only the train departing soonest
    const filtered = [...passThroughTrains];
    for (const group of firstStopGroups.values()) {
      group.sort((a, b) => (a.nextTimeMs ?? Infinity) - (b.nextTimeMs ?? Infinity));
      filtered.push(group[0]);
    }

    dispatch({
      type: 'SYNC_TRAINS',
      trains: filtered,
      nowMs: Date.now(),
      isAtLastStop,
    });
  }, [trains]);

  // Effect 4: Update latestApiDataRef whenever trains change (for animation loop to read)
  useEffect(() => {
    if (!state.trackUtilsLoaded || !getStopArclength) return;

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
  }, [trains, state.trackUtilsLoaded]);

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
      dispatch({ type: 'REMOVE_MARKER', tripId });
    }, FADE_DURATION_MS);

    fadingOutRef.current.set(tripId, { marker: unifiedState.marker, popup: unifiedState.popup, timeoutId, unifiedState });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 5: DOM Sync — maps state.markers → DOM
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;

    // Increment generation for async cancellation
    const generation = ++processingGenRef.current;

    // Calculate clustering offsets from visible markers in state
    const trainsWithPosition: TrainWithPosition[] = [];
    for (const train of trains) {
      const record = state.markers.get(train.tripId);
      if (record && record.visible && record.status === 'active') {
        trainsWithPosition.push({
          tripId: train.tripId,
          lat: train.lat,
          lon: train.lon,
          routeId: train.routeId,
        });
      }
    }
    const trainOffsets = calculateTrainOffsets(trainsWithPosition);

    const nowMs = Date.now();
    const now = performance.now();

    // ── Phase 1: REMOVE ──
    // Remove markers that are in DOM but should be gone
    trainMarkersRef.current.forEach((entry, tripId) => {
      const record = state.markers.get(tripId);
      if (!record || record.status === 'removed') {
        // Immediate removal
        entry.popup.remove();
        if (entry.cleanupListeners) entry.cleanupListeners();
        entry.marker.remove();
        trainMarkersRef.current.delete(tripId);
      } else if (record.status === 'fading') {
        // Fade out (only if not already fading)
        if (!fadingOutRef.current.has(tripId)) {
          fadeOutAndRemove(tripId, entry);
        }
        trainMarkersRef.current.delete(tripId);
      }
    });

    // Also purge fadingOutRef entries that are filtered out
    if (state.filterSet.size > 0) {
      fadingOutRef.current.forEach(({ timeoutId, marker, unifiedState }, tripId) => {
        if (!routeMatchesFilter(unifiedState.routeId ?? '', state.filterSet)) {
          clearTimeout(timeoutId);
          if (unifiedState.cleanupListeners) unifiedState.cleanupListeners();
          marker.remove();
          fadingOutRef.current.delete(tripId);
        }
      });
    }

    // ── Phase 2: UPDATE ──
    // Update visibility, opacity for existing markers
    trainMarkersRef.current.forEach((entry, tripId) => {
      const record = state.markers.get(tripId);
      if (!record) return;

      const el = entry.marker.getElement();

      // Atomic visibility from reducer state
      el.style.display = record.visible ? 'flex' : 'none';

      // Opacity from lifecycle status
      el.style.opacity = record.status === 'stale-dim' ? '0.4' : '1';
    });

    // ── Phase 3: CREATE ──
    // Create markers for records in state but not in DOM
    const toCreate: Array<{ tripId: string; train: TrainPosition }> = [];
    state.markers.forEach((record, tripId) => {
      if (record.status === 'removed' || record.status === 'fading') return;
      if (trainMarkersRef.current.has(tripId)) return;

      // Find the train data
      const train = trains.find(t => t.tripId === tripId);
      if (!train) return;

      // Check for resurrection from fading
      const fading = fadingOutRef.current.get(tripId);
      if (fading) {
        clearTimeout(fading.timeoutId);
        fadingOutRef.current.delete(tripId);
        if (record.visible) {
          fading.marker.getElement().style.opacity = '1';
          fading.marker.getElement().style.display = 'flex';
        } else {
          fading.marker.getElement().style.display = 'none';
        }
        trainMarkersRef.current.set(tripId, fading.unifiedState);
      } else {
        toCreate.push({ tripId, train });
      }
    });

    // Async creation
    void Promise.all(toCreate.map(async ({ tripId, train }) => {
      if (generation !== processingGenRef.current) return;

      const color = getRouteColor(train.routeId);
      const direction = getDirectionFromStopId(train.nextStopId);

      if (useAlphaBetaGamma && state.trackUtilsLoaded && getRouteTrack && getStopArclength) {
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

        // Read LATEST visibility from stateRef (not closure!)
        const latestRecord = stateRef.current.markers.get(tripId);
        const visible = latestRecord?.visible ?? true;

        const motionState = await createMotionState(
          train, map, color, direction, nowMs, setSelectedTrain,
          durationMatrix, scheduledDuration, speedMultiplier, refreshInterval, visible
        );
        if (generation !== processingGenRef.current) {
          if (motionState) {
            motionState.marker.remove();
            motionState.popup.remove();
          }
          return;
        }
        if (motionState) {
          trainMarkersRef.current.set(tripId, { type: 'motion', ...motionState });
          const offset = trainOffsets.get(tripId);
          if (offset) {
            motionState.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        } else {
          // Fallback to legacy
          const latestRecord2 = stateRef.current.markers.get(tripId);
          const visible2 = latestRecord2?.visible ?? true;
          createLegacyMarker(train, map, color, direction, now, trainMarkersRef, setSelectedTrain, visible2);
          const newEntry = trainMarkersRef.current.get(tripId);
          const offset = trainOffsets.get(tripId);
          if (newEntry && offset) {
            newEntry.marker.setOffset([offset.offsetX, offset.offsetY]);
          }
        }
      } else {
        // Legacy path
        const latestRecord = stateRef.current.markers.get(tripId);
        const visible = latestRecord?.visible ?? true;
        createLegacyMarker(train, map, color, direction, now, trainMarkersRef, setSelectedTrain, visible);
        const newEntry = trainMarkersRef.current.get(tripId);
        const offset = trainOffsets.get(tripId);
        if (newEntry && offset) {
          newEntry.marker.setOffset([offset.offsetX, offset.offsetY]);
        }
      }
    })).then(() => {
      if (generation === processingGenRef.current) {
        scheduleAnimation();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, mapLoaded]);

  // Effect 6: Update existing markers with new API data
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map || trains.length === 0) return;

    const generation = processingGenRef.current;
    const nowMs = Date.now();
    const now = performance.now();

    // Calculate clustering offsets
    const trainsWithPosition: TrainWithPosition[] = trains
      .filter(t => {
        const r = state.markers.get(t.tripId);
        return r && r.visible && r.status === 'active';
      })
      .map(t => ({ tripId: t.tripId, lat: t.lat, lon: t.lon, routeId: t.routeId }));
    const trainOffsets = calculateTrainOffsets(trainsWithPosition);

    void Promise.all(trains.map(async (train) => {
      if (generation !== processingGenRef.current) return;

      const existingEntry = trainMarkersRef.current.get(train.tripId);
      if (!existingEntry) return;  // New markers handled by DOM sync

      const color = getRouteColor(train.routeId);
      const direction = getDirectionFromStopId(train.nextStopId);

      if (existingEntry.type === 'motion' && useAlphaBetaGamma && state.trackUtilsLoaded && getRouteTrack && getStopArclength) {
        // --- Motion marker update ---
        let scheduledDuration = 90;
        if (durationMatrix && getSegmentDuration) {
          const duration = getSegmentDuration(
            durationMatrix,
            train.routeId,
            existingEntry.api.prevStopId,
            existingEntry.api.nextStopId
          );
          if (duration) scheduledDuration = duration;
        }

        const apiDuration = ((train.nextTimeMs || nowMs + 90000) - (train.prevTimeMs || nowMs)) / 1000;
        const speedMultiplier = apiDuration > 0 ? scheduledDuration / apiDuration : 1.0;

        if (existingEntry.animation.animState && trainAnimationReducer) {
          existingEntry.animation.animState = trainAnimationReducer(existingEntry.animation.animState, {
            type: 'SET_DURATION',
            duration: scheduledDuration
          });
          existingEntry.animation.animState = trainAnimationReducer(existingEntry.animation.animState, {
            type: 'SET_SPEED_MULTIPLIER',
            multiplier: speedMultiplier
          });
        }

        await updateMotionState(existingEntry, train, nowMs);
        if (generation !== processingGenRef.current) return;

        existingEntry.popup.setHTML(buildTrainPopupHTML(
          train, color, undefined,
          existingEntry.animation.filter.s, existingEntry.api.nextS
        ));

        const offset = trainOffsets.get(train.tripId);
        if (offset) existingEntry.marker.setOffset([offset.offsetX, offset.offsetY]);

      } else if (existingEntry.type === 'legacy') {
        // --- Legacy marker update ---
        const elapsed = now - existingEntry.startTime;
        const progress = Math.min(elapsed / refreshInterval, 1);

        const currentLng = lerp(existingEntry.fromLng, existingEntry.toLng, progress);
        const currentLat = lerp(existingEntry.fromLat, existingEntry.toLat, progress);

        const dist = Math.sqrt(Math.pow(train.lon - currentLng, 2) + Math.pow(train.lat - currentLat, 2));
        const isDwelling = dist < MAP_CONSTANTS.DWELLING_THRESHOLD;

        existingEntry.fromLng = currentLng;
        existingEntry.fromLat = currentLat;
        existingEntry.toLng = train.lon;
        existingEntry.toLat = train.lat;
        existingEntry.startTime = now;
        existingEntry.isDwelling = isDwelling;
        existingEntry.nextStopId = train.nextStopId;
        existingEntry.nextStopName = train.nextStopName;
        existingEntry.eta = train.eta;
        existingEntry.direction = direction;

        existingEntry.popup.setHTML(buildTrainPopupHTML(train, color));

        const offset = trainOffsets.get(train.tripId);
        if (offset) existingEntry.marker.setOffset([offset.offsetX, offset.offsetY]);
      }
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trains, mapLoaded]);

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

  // Get current phase for a train from motion state
  const getTrainPhase = useCallback((tripId: string): 'BOARDING' | 'ARRIVING' | 'APPROACHING' | null => {
    const entry = trainMarkersRef.current.get(tripId);
    if (!entry || entry.type !== 'motion') return null;
    return entry.animation.lastPhase || getPhaseFromDistance(entry.animation.filter.s, entry.api.nextS);
  }, [trainMarkersRef]);

  return { visibleTrainCount: state.visibleCount, latestApiDataRef, getTrainPhase };
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
 * @param refreshInterval - Polling interval in milliseconds
 * @param visible - Whether the marker should be initially visible
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
  refreshInterval: number,
  visible: boolean = true
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
    display: ${visible ? 'flex' : 'none'};
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
 * @param visible - Whether the marker should be initially visible
 */
function createLegacyMarker(
  train: TrainPosition,
  map: maplibregl.Map,
  color: string,
  direction: 'N' | 'S' | null,
  now: number,
  trainMarkersRef: React.MutableRefObject<Map<string, UnifiedMarkerState>>,
  setSelectedTrain: (tripId: string | null) => void,
  visible: boolean = true
): void {
  const el = document.createElement('div');
  el.className = 'train-marker';
  el.style.cssText = `
    width: 22px;
    height: 22px;
    background-color: ${color};
    border: 2px solid white;
    border-radius: 4px;
    display: ${visible ? 'flex' : 'none'};
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
