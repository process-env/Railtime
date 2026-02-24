/**
 * Pure reducer for train marker logical state.
 *
 * No DOM, no MapLibre, no React imports.
 * All map mutations are driven by the state this reducer produces.
 */

import { buildRouteFilterSet, routeMatchesFilter } from '@/lib/mta/route-matching';
import type { TrainPosition } from '@/types/mta';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_DIM_MS = 120_000;   // 2 min  -- dim to 0.4 opacity
const STALE_CULL_MS = 600_000;  // 10 min -- hard cull

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarkerLifecycle = 'active' | 'stale-dim' | 'fading' | 'removed';

export interface MarkerRecord {
  tripId: string;
  routeId: string;
  visible: boolean;           // computed from filter atomically
  status: MarkerLifecycle;
  lastApiUpdate: number;
  prevStopId: string;
  nextStopId: string;
}

export interface TrainMarkerState {
  markers: Map<string, MarkerRecord>;
  filterRouteIds: string[];
  filterSet: Set<string>;     // cached from filterRouteIds for O(1) lookup
  trackUtilsLoaded: boolean;
  generation: number;
  visibleCount: number;       // derived count
}

export type TrainMarkerAction =
  | {
      type: 'SYNC_TRAINS';
      trains: TrainPosition[];
      nowMs: number;
      isAtFirstStop: (routeId: string, prevStopId: string) => boolean;
      isAtLastStop: (routeId: string, nextStopId: string) => boolean;
    }
  | { type: 'FILTER_CHANGED'; selectedRouteIds: string[] }
  | { type: 'TRACK_UTILS_LOADED' }
  | { type: 'REMOVE_MARKER'; tripId: string };

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export function createInitialState(): TrainMarkerState {
  return {
    markers: new Map(),
    filterRouteIds: [],
    filterSet: new Set(),
    trackUtilsLoaded: false,
    generation: 0,
    visibleCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function trainMarkerReducer(
  state: TrainMarkerState,
  action: TrainMarkerAction,
): TrainMarkerState {
  switch (action.type) {
    case 'SYNC_TRAINS':
      return handleSyncTrains(state, action);
    case 'FILTER_CHANGED':
      return handleFilterChanged(state, action);
    case 'TRACK_UTILS_LOADED':
      return { ...state, trackUtilsLoaded: true };
    case 'REMOVE_MARKER':
      return handleRemoveMarker(state, action);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countVisible(markers: Map<string, MarkerRecord>): number {
  let count = 0;
  markers.forEach((record) => {
    if (record.visible && record.status !== 'removed' && record.status !== 'fading') {
      count++;
    }
  });
  return count;
}

// ---------------------------------------------------------------------------
// SYNC_TRAINS
// ---------------------------------------------------------------------------

function handleSyncTrains(
  state: TrainMarkerState,
  action: Extract<TrainMarkerAction, { type: 'SYNC_TRAINS' }>,
): TrainMarkerState {
  const { trains, nowMs, isAtFirstStop, isAtLastStop } = action;
  const { filterSet } = state;

  // 1. Copy markers for immutability
  const next = new Map(state.markers);

  // 2. Dedupe incoming trains by tripId (keep first occurrence)
  const seen = new Set<string>();
  const deduped: TrainPosition[] = [];
  for (const train of trains) {
    if (!seen.has(train.tripId)) {
      seen.add(train.tripId);
      deduped.push(train);
    }
  }

  // 3. Upsert trains that are present in this cycle
  const currentTripIds = new Set<string>();

  for (const train of deduped) {
    currentTripIds.add(train.tripId);
    const existing = next.get(train.tripId);

    if (existing) {
      // Update existing marker
      next.set(train.tripId, {
        ...existing,
        lastApiUpdate: nowMs,
        prevStopId: train.prevStopId ?? '',
        nextStopId: train.nextStopId,
        status: 'active',
        visible: routeMatchesFilter(train.routeId, filterSet),
      });
    } else {
      // Entry gate: skip trains sitting at their first stop
      if (isAtFirstStop(train.routeId, train.prevStopId ?? '')) {
        continue;
      }

      // Add new marker
      next.set(train.tripId, {
        tripId: train.tripId,
        routeId: train.routeId,
        visible: routeMatchesFilter(train.routeId, filterSet),
        status: 'active',
        lastApiUpdate: nowMs,
        prevStopId: train.prevStopId ?? '',
        nextStopId: train.nextStopId,
      });
    }
  }

  // 4. Handle disappeared trains
  next.forEach((record, tripId) => {
    if (currentTripIds.has(tripId)) return;

    // Filtered-out routes get removed immediately
    if (filterSet.size > 0 && !routeMatchesFilter(record.routeId, filterSet)) {
      next.set(tripId, { ...record, status: 'removed' });
      return;
    }

    // Train at its last stop -- fade out
    if (isAtLastStop(record.routeId, record.nextStopId)) {
      next.set(tripId, { ...record, status: 'fading' });
      return;
    }

    // Staleness check
    const timeSinceUpdate = nowMs - record.lastApiUpdate;
    if (timeSinceUpdate > STALE_CULL_MS) {
      next.set(tripId, { ...record, status: 'fading' });
    } else if (timeSinceUpdate > STALE_DIM_MS) {
      next.set(tripId, { ...record, status: 'stale-dim' });
    }
    // Otherwise leave status unchanged
  });

  // 5. Derive visible count
  const visibleCount = countVisible(next);

  return {
    ...state,
    markers: next,
    generation: state.generation + 1,
    visibleCount,
  };
}

// ---------------------------------------------------------------------------
// FILTER_CHANGED
// ---------------------------------------------------------------------------

function handleFilterChanged(
  state: TrainMarkerState,
  action: Extract<TrainMarkerAction, { type: 'FILTER_CHANGED' }>,
): TrainMarkerState {
  const filterSet = buildRouteFilterSet(action.selectedRouteIds);
  const next = new Map(state.markers);

  next.forEach((record, tripId) => {
    const visible = filterSet.size === 0 || routeMatchesFilter(record.routeId, filterSet);
    if (visible !== record.visible) {
      next.set(tripId, { ...record, visible });
    }
  });

  const visibleCount = countVisible(next);

  return {
    ...state,
    filterRouteIds: action.selectedRouteIds,
    filterSet,
    markers: next,
    visibleCount,
  };
}

// ---------------------------------------------------------------------------
// REMOVE_MARKER
// ---------------------------------------------------------------------------

function handleRemoveMarker(
  state: TrainMarkerState,
  action: Extract<TrainMarkerAction, { type: 'REMOVE_MARKER' }>,
): TrainMarkerState {
  const next = new Map(state.markers);
  next.delete(action.tripId);
  const visibleCount = countVisible(next);

  return {
    ...state,
    markers: next,
    visibleCount,
  };
}
