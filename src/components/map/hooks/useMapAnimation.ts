/**
 * useMapAnimation - Schedule-based train animation with state machine
 *
 * This hook manages smooth train animation using:
 * - State machine reducer for predictable timing transitions
 * - Arclength-based track following
 * - Pre-computed duration matrix from GTFS stop_times.txt
 * - Alert-based speed modulation (delays slow down animation)
 * - Direct lerp with SNAP to station on arrival
 */

import { useRef, useCallback, useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { buildTrainPopupHTML } from '@/components/map/utils/popup';
import type { RouteTrack } from '@/lib/map/track-index';
import type { FilterState, FilterParams } from '@/lib/map/alpha-beta-gamma';
import type { MotionPlan } from '@/lib/map/motion-planner';
import type { TrainAnimationState, TrainAction } from '@/lib/map/train-state-machine';

/**
 * Fields owned exclusively by the RAF animation loop.
 *
 * Only the `animateTrains` callback in `useMapAnimation` should write to these.
 * The data-update effect in `useTrainMarkers` may *read* them (e.g. `filter.s`
 * for segmentStartTime calculation) but should not write directly except through
 * the `pendingSegment` message queue.
 */
export interface TrainAnimationFields {
  /** Current position / velocity / acceleration from α-β-γ filter */
  filter: FilterState;
  /** Timestamp of the last RAF frame (performance.now()) */
  lastFrameTime: number;
  /** Last arclength actually rendered — fallback anchor for NaN guard */
  lastRenderedS?: number;
  /** State machine state (currently disabled — null) */
  animState: TrainAnimationState | null;
  /** Phase tracking for popup updates during animation */
  lastPhase?: 'BOARDING' | 'ARRIVING' | 'APPROACHING';
  /** When train arrived at station (ms timestamp) — set by RAF or API effect */
  dwellStartTime?: number;
  /**
   * Pending segment queued by the API data-update effect for the RAF loop to consume.
   * Written by `updateMotionState`, consumed and cleared by the RAF loop after dwell completes.
   */
  pendingSegment?: {
    prevStopId: string;
    nextStopId: string;
    prevS: number;
    nextS: number;
    scheduledDuration: number;
    nextStopName: string;
    eta: string;
  };
}

/**
 * Fields owned exclusively by the API data-update effect.
 *
 * Only `createMotionState`, `updateMotionState`, and the main marker-processing
 * effect in `useTrainMarkers` should write to these. The RAF animation loop may
 * *read* them (e.g. `prevS`, `nextS` for interpolation) but should not write
 * to them except when consuming a `pendingSegment`.
 */
export interface TrainApiFields {
  /** Previous stop ID from API */
  prevStopId: string;
  /** Next stop ID from API */
  nextStopId: string;
  /** Departure time from previous stop (ms epoch) */
  prevTimeMs: number;
  /** Expected arrival time at next stop (ms epoch) */
  nextTimeMs: number;
  /** Arclength of previous stop (meters from route start) */
  prevS: number;
  /** Arclength of next stop (meters from route start) */
  nextS: number;
  /** When train entered this segment (ms epoch) */
  segmentStartTime: number;
  /** Expected duration from GTFS matrix (seconds) */
  scheduledDuration: number;
  /** API-derived speed adjustment factor */
  speedMultiplier: number;
  /** Display: next station name */
  nextStopName: string;
  /** Display: estimated arrival time string */
  eta: string;
  /** Display: headsign / destination */
  headsign?: string;
  /** Travel direction */
  direction: 'N' | 'S' | null;
  /** Timestamp of last API data update (Date.now()) */
  lastApiUpdate: number;
}

export interface TrainMotionState {
  // Identity
  tripId: string;
  routeId: string;
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;

  // Track reference
  track: RouteTrack | null;

  // Motion plan (deprecated, kept for compatibility)
  plan: MotionPlan | null;

  /** Animation state — owned by RAF loop */
  animation: TrainAnimationFields;

  /** API data — owned by data-update effect */
  api: TrainApiFields;

  // Event listener cleanup function (removes mouseenter, mouseleave, click)
  cleanupListeners?: () => void;
}

/**
 * @deprecated Legacy animation state - used only as fallback when track data unavailable.
 * Prefer TrainMotionState for new code.
 */
export interface TrainAnimState {
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;
  fromLng: number;
  fromLat: number;
  toLng: number;
  toLat: number;
  startTime: number;
  isDwelling: boolean;
  routeId: string;
  nextStopId: string;       // Needed for last-stop detection in exit gate
  nextStopName: string;
  eta: string;
  direction: 'N' | 'S' | null;
  // Event listener cleanup function (removes mouseenter, mouseleave, click)
  cleanupListeners?: () => void;
}

/**
 * Discriminated union that unifies motion-based and legacy marker states
 * into a single map. Use `entry.type` to narrow before accessing type-specific fields.
 */
export type UnifiedMarkerState =
  | ({ type: 'motion' } & TrainMotionState)
  | ({ type: 'legacy' } & TrainAnimState);

interface UseMapAnimationOptions {
  refreshInterval: number;
  useAlphaBetaGamma?: boolean;  // Enable new animation system
}

interface UseMapAnimationReturn {
  trainMarkersRef: React.MutableRefObject<Map<string, UnifiedMarkerState>>;
  lerp: (start: number, end: number, t: number) => number;
  scheduleAnimation: () => void;
}

// Distance thresholds (meters) - same as train-state-machine.ts
const ARRIVING_DISTANCE = 200;
const STATION_SNAP_DISTANCE = 20;
const DWELL_DURATION_MS = 2000;  // 2 seconds at station before departing

const BLEND_SPEED = 0.06;  // Per-frame at 60fps — ~95% in 0.8s, ~99.6% in 1.5s

/** Guard against NaN/Infinity arclength. Returns fallback if invalid. */
function safeArclength(s: number, fallback: number | undefined, fallback2?: number): number {
  if (Number.isFinite(s)) return s;
  if (fallback !== undefined && Number.isFinite(fallback)) return fallback;
  if (fallback2 !== undefined && Number.isFinite(fallback2)) return fallback2;
  return 0;
}

// Calculate phase from distance
function getPhaseFromDistance(currentS: number, nextS: number): 'BOARDING' | 'ARRIVING' | 'APPROACHING' {
  const distance = Math.abs(nextS - currentS);
  if (distance <= STATION_SNAP_DISTANCE) return 'BOARDING';
  if (distance <= ARRIVING_DISTANCE) return 'ARRIVING';
  return 'APPROACHING';
}

// Import motion utilities dynamically to avoid SSR issues
let arclengthToLatLon: ((s: number, track: RouteTrack) => [number, number]) | null = null;
let _evaluatePlan: ((plan: MotionPlan, time: number) => number) | null = null;
let _predictPosition: ((state: FilterState, targetTime: number, params: FilterParams) => number) | null = null;
let trainAnimationReducer: ((state: TrainAnimationState, action: TrainAction) => TrainAnimationState) | null = null;
let getCurrentArclength: ((state: TrainAnimationState) => number) | null = null;
let _DEFAULT_FILTER_PARAMS: FilterParams | null = null;
let _MOTION_PARAMS: Record<string, unknown> | null = null;
let getRouteColor: ((routeId: string) => string) | null = null;
// These format utilities were previously used by the local createPopupHTMLForAnimation
// function, which has been replaced by the shared buildTrainPopupHTML utility.
// They are still loaded to avoid breaking the dynamic import bundle but are unused.
let _getTextColorForBackground: ((color: string) => string) | null = null;
let _getDirectionFromStopId: ((stopId: string) => 'N' | 'S' | null) | null = null;
let _getDirectionLabel: ((direction: 'N' | 'S' | null) => string) | null = null;
let _formatEta: ((eta: string, format?: 'short' | 'long') => string) | null = null;

// Load motion utilities
async function loadMotionUtils() {
  if (!arclengthToLatLon) {
    const [arclengthModule, plannerModule, filterModule, stateMachineModule, constantsModule, formatModule] = await Promise.all([
      import('@/lib/map/arclength'),
      import('@/lib/map/motion-planner'),
      import('@/lib/map/alpha-beta-gamma'),
      import('@/lib/map/train-state-machine'),
      import('@/lib/constants'),
      import('@/lib/mta/format')
    ]);
    arclengthToLatLon = arclengthModule.arclengthToLatLon;
    _evaluatePlan = plannerModule.evaluatePlan;
    _predictPosition = filterModule.predictPosition;
    trainAnimationReducer = stateMachineModule.trainAnimationReducer;
    getCurrentArclength = stateMachineModule.getCurrentArclength;
    _DEFAULT_FILTER_PARAMS = filterModule.DEFAULT_FILTER_PARAMS;
    _MOTION_PARAMS = plannerModule.MOTION_PARAMS;
    getRouteColor = constantsModule.getRouteColor;
    _getTextColorForBackground = formatModule.getTextColorForBackground;
    _getDirectionFromStopId = formatModule.getDirectionFromStopId;
    _getDirectionLabel = formatModule.getDirectionLabel;
    _formatEta = formatModule.formatEta;
  }
}

// Train popup HTML is now generated by the shared buildTrainPopupHTML utility
// in src/components/map/utils/popup.ts to avoid duplication with useTrainMarkers.

/**
 * Hook to manage train animation loop using requestAnimationFrame
 * Supports both legacy lerp animation and new α-β-γ filter animation
 */
export function useMapAnimation(
  mapLoaded: boolean,
  options: UseMapAnimationOptions
): UseMapAnimationReturn {
  // Unified marker state: single map with 'motion' | 'legacy' discriminant
  const trainMarkersRef = useRef<Map<string, UnifiedMarkerState>>(new Map());

  const animationFrameRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);
  const motionUtilsLoaded = useRef(false);
  const animateTrainsRef = useRef<(() => void) | null>(null);

  // Load motion utilities on mount
  useEffect(() => {
    if (options.useAlphaBetaGamma) {
      loadMotionUtils().then(() => {
        motionUtilsLoaded.current = true;
      });
    }
  }, [options.useAlphaBetaGamma]);

  // Linear interpolation helper (legacy)
  const lerp = useCallback((start: number, end: number, t: number) => {
    return start + (end - start) * t;
  }, []);

  // Check if any trains need animation
  const hasMovingTrains = useCallback(() => {
    const now = performance.now();
    for (const entry of trainMarkersRef.current.values()) {
      if (entry.type === 'legacy') {
        if (entry.isDwelling) continue;
        const elapsed = now - entry.startTime;
        const progress = elapsed / options.refreshInterval;
        if (progress < 1) return true;
      } else {
        // Motion-based trains always need animation
        return true;
      }
    }
    return false;
  }, [options.refreshInterval]);

  // Animation loop
  const animateTrains = useCallback(() => {
    const now = performance.now();
    const nowMs = Date.now();
    let anyMoving = false;

    // Animate all markers from the unified map
    trainMarkersRef.current.forEach((entry) => {
      // Legacy animation: simple lat/lng interpolation
      if (entry.type === 'legacy') {
        if (entry.isDwelling) return;
        const elapsed = now - entry.startTime;
        const progress = Math.min(elapsed / options.refreshInterval, 1);
        if (progress < 1) anyMoving = true;
        const currentLng = lerp(entry.fromLng, entry.toLng, progress);
        const currentLat = lerp(entry.fromLat, entry.toLat, progress);
        entry.marker.setLngLat([currentLng, currentLat]);
        return; // Done with this legacy entry
      }

      // Motion-based animation: arclength along track
      const state = entry; // type narrowed to 'motion' & TrainMotionState
      if (!motionUtilsLoaded.current || !arclengthToLatLon || !trainAnimationReducer || !getCurrentArclength) return;
      {
        if (!state.track) return;
        const { animation: anim, api } = state;

        anyMoving = true;
        const frameDtMs = now - anim.lastFrameTime;  // Time since last frame (ms)
        anim.lastFrameTime = now;

        // Check distance to current station
        const distanceToStation = Math.abs(api.nextS - anim.filter.s);
        const atStation = distanceToStation <= STATION_SNAP_DISTANCE;

        // Handle dwell and pending segment transitions
        if (atStation) {
          // Snap to exact station position
          anim.filter.s = safeArclength(api.nextS, anim.lastRenderedS);
          anim.lastRenderedS = anim.filter.s;

          // Start dwell timer if not already started
          if (!anim.dwellStartTime) {
            anim.dwellStartTime = nowMs;
          }

          // Check if we have a pending segment and dwell is complete
          if (anim.pendingSegment && anim.dwellStartTime) {
            const dwellElapsed = nowMs - anim.dwellStartTime;
            if (dwellElapsed >= DWELL_DURATION_MS) {
              // Dwell complete - transition to pending segment
              // RAF consumes the pending data and writes to api sub-object
              const pending = anim.pendingSegment;
              api.prevStopId = pending.prevStopId;
              api.nextStopId = pending.nextStopId;
              api.prevS = pending.prevS;
              api.nextS = pending.nextS;
              api.scheduledDuration = pending.scheduledDuration;
              api.speedMultiplier = 1.0;
              api.nextStopName = pending.nextStopName;
              api.eta = pending.eta;
              api.segmentStartTime = nowMs;
              anim.filter.s = safeArclength(pending.prevS, anim.lastRenderedS);  // Start from the station we just left
              anim.lastRenderedS = anim.filter.s;
              anim.pendingSegment = undefined;
              anim.dwellStartTime = undefined;
            }
          }

          // Update marker position at station
          const [lat, lon] = arclengthToLatLon!(anim.filter.s, state.track);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            state.marker.setLngLat([lon, lat]);
          }
        } else {
          // Not at station - animate toward it
          // Clear dwell timer since we're moving
          anim.dwellStartTime = undefined;

          // Use state machine if available
          if (anim.animState) {
            // Dispatch TICK to state machine - handles all timing transitions
            // Non-null assertion safe: guarded by null check at outer scope
            anim.animState = trainAnimationReducer!(anim.animState, {
              type: 'TICK',
              nowMs
            });

            // Get current position from state machine
            const currentS_sm = getCurrentArclength!(anim.animState);
            let targetS_sm = safeArclength(currentS_sm, anim.lastRenderedS, api.prevS);

            // Blend from rendered position toward state machine target
            const currentRendered = anim.lastRenderedS ?? targetS_sm;

            // Monotonicity: never move backward — a still train is fine, a reversing train is not
            if (api.prevS <= api.nextS) {
              targetS_sm = Math.max(targetS_sm, currentRendered);
            } else {
              targetS_sm = Math.min(targetS_sm, currentRendered);
            }
            const blend_sm = 1 - Math.pow(1 - BLEND_SPEED, Math.max(0.5, frameDtMs / 16.67));
            anim.filter.s = currentRendered + (targetS_sm - currentRendered) * blend_sm;
            if (Math.abs(anim.filter.s - targetS_sm) < 1) {
              anim.filter.s = targetS_sm;
            }
            if (!Number.isFinite(anim.filter.s)) {
              anim.filter.s = anim.lastRenderedS ?? api.prevS;
            }
            anim.lastRenderedS = anim.filter.s;

            // Convert arclength to lat/lon
            const [lat, lon] = arclengthToLatLon!(anim.filter.s, state.track);

            // Update marker position
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              state.marker.setLngLat([lon, lat]);
            }
          } else {
            // Fallback: schedule-based animation with smooth blending
            const adjustedDuration = api.scheduledDuration / Math.max(0.01, api.speedMultiplier);
            const elapsed = (nowMs - api.segmentStartTime) / 1000;
            const rawProgress = adjustedDuration > 0 ? elapsed / adjustedDuration : 1;
            const progress = Math.max(0, Math.min(1, rawProgress));

            // Calculate target position from schedule
            let targetS: number;
            if (progress >= 1.0) {
              targetS = api.nextS;
            } else {
              targetS = api.prevS + (api.nextS - api.prevS) * progress;
            }

            // Clamp target to segment bounds
            const minS = Math.min(api.prevS, api.nextS);
            const maxS = Math.max(api.prevS, api.nextS);
            targetS = Math.max(minS, Math.min(maxS, targetS));

            // NaN guard on target
            targetS = safeArclength(targetS, anim.lastRenderedS, api.prevS);

            // Smooth blend from current rendered position toward target
            // Prevents teleportation on segment changes while tracking API data
            const currentS = anim.lastRenderedS ?? targetS;

            // Monotonicity: never move backward — a still train is fine, a reversing train is not
            if (api.prevS <= api.nextS) {
              targetS = Math.max(targetS, currentS);
            } else {
              targetS = Math.min(targetS, currentS);
            }

            const dtNorm = Math.max(0.5, frameDtMs / 16.67);  // Normalize to 60fps
            const blend = 1 - Math.pow(1 - BLEND_SPEED, dtNorm);
            anim.filter.s = currentS + (targetS - currentS) * blend;

            // Snap when very close to avoid asymptotic hover
            if (Math.abs(anim.filter.s - targetS) < 1) {
              anim.filter.s = targetS;
            }
            if (!Number.isFinite(anim.filter.s)) {
              anim.filter.s = anim.lastRenderedS ?? api.prevS;
            }

            anim.lastRenderedS = anim.filter.s;

            const [lat, lon] = arclengthToLatLon!(anim.filter.s, state.track);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              state.marker.setLngLat([lon, lat]);
            }
          }
        }

        // Check for phase change and update popup if needed
        const currentPhase = getPhaseFromDistance(anim.filter.s, api.nextS);
        if (currentPhase !== anim.lastPhase) {
          anim.lastPhase = currentPhase;
          // getRouteColor is guaranteed non-null here (guarded by motionUtilsLoaded check above)
          const color = getRouteColor!(state.routeId);
          const popupData = {
            routeId: state.routeId,
            nextStopId: api.nextStopId,
            nextStopName: api.nextStopName,
            eta: api.eta,
            headsign: api.headsign,
          };
          const html = buildTrainPopupHTML(popupData, color, currentPhase);
          if (html) {
            state.popup.setHTML(html);
          }
        }
      } // end block for motion utils guard
    }); // end trainMarkersRef.current.forEach

    // Continue animation loop if there are moving trains
    if (anyMoving) {
      animationFrameRef.current = requestAnimationFrame(() => animateTrainsRef.current?.());
    } else {
      isAnimatingRef.current = false;
    }
  }, [lerp, options.refreshInterval]);

  // Keep ref in sync so the animation loop can self-schedule
  useEffect(() => {
    animateTrainsRef.current = animateTrains;
  }, [animateTrains]);

  // Schedule animation (call after train positions are updated)
  const scheduleAnimation = useCallback(() => {
    if (!mapLoaded) return;

    // Don't start if already animating
    if (isAnimatingRef.current) return;

    // Check if there are trains to animate
    if (!hasMovingTrains()) return;

    isAnimatingRef.current = true;
    animationFrameRef.current = requestAnimationFrame(animateTrains);
  }, [mapLoaded, hasMovingTrains, animateTrains]);

  // Start animation loop when map loads
  useEffect(() => {
    if (mapLoaded && trainMarkersRef.current.size > 0) {
      scheduleAnimation();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      isAnimatingRef.current = false;
    };
  }, [mapLoaded, scheduleAnimation]);

  return {
    trainMarkersRef,
    lerp,
    scheduleAnimation,
  };
}
