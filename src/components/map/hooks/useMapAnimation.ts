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

export interface TrainMotionState {
  // Identity
  tripId: string;
  routeId: string;
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;

  // Track reference
  track: RouteTrack | null;

  // Position state (simplified from α-β-γ)
  filter: FilterState;

  // Motion plan (deprecated, kept for compatibility)
  plan: MotionPlan | null;

  // Last API data
  prevStopId: string;
  nextStopId: string;
  prevTimeMs: number;
  nextTimeMs: number;
  prevS: number;           // Arclength of prev stop
  nextS: number;           // Arclength of next stop

  // Schedule-based animation
  segmentStartTime: number;    // When train entered this segment (ms)
  scheduledDuration: number;   // Expected duration from matrix (seconds)
  speedMultiplier: number;     // Alert-based speed adjustment (0.5-1.0)

  // State machine (new)
  animState: TrainAnimationState | null;

  // Display data
  nextStopName: string;
  eta: string;
  headsign?: string;
  direction: 'N' | 'S' | null;

  // Animation state
  lastFrameTime: number;
  lastRenderedS?: number;  // Last arclength actually rendered — fallback anchor for NaN guard
  lastApiUpdate: number;

  // Phase tracking for popup updates
  lastPhase?: 'BOARDING' | 'ARRIVING' | 'APPROACHING';

  // Dwell and pending segment for smooth station transitions
  dwellStartTime?: number;  // When train arrived at station (ms timestamp)
  pendingSegment?: {
    prevStopId: string;
    nextStopId: string;
    prevS: number;
    nextS: number;
    scheduledDuration: number;
    nextStopName: string;
    eta: string;
  };

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

        anyMoving = true;
        const frameDtMs = now - state.lastFrameTime;  // Time since last frame (ms)
        state.lastFrameTime = now;

        // Check distance to current station
        const distanceToStation = Math.abs(state.nextS - state.filter.s);
        const atStation = distanceToStation <= STATION_SNAP_DISTANCE;

        // Handle dwell and pending segment transitions
        if (atStation) {
          // Snap to exact station position
          state.filter.s = safeArclength(state.nextS, state.lastRenderedS);
          state.lastRenderedS = state.filter.s;

          // Start dwell timer if not already started
          if (!state.dwellStartTime) {
            state.dwellStartTime = nowMs;
          }

          // Check if we have a pending segment and dwell is complete
          if (state.pendingSegment && state.dwellStartTime) {
            const dwellElapsed = nowMs - state.dwellStartTime;
            if (dwellElapsed >= DWELL_DURATION_MS) {
              // Dwell complete - transition to pending segment
              const pending = state.pendingSegment;
              state.prevStopId = pending.prevStopId;
              state.nextStopId = pending.nextStopId;
              state.prevS = pending.prevS;
              state.nextS = pending.nextS;
              state.scheduledDuration = pending.scheduledDuration;
              state.speedMultiplier = 1.0;
              state.nextStopName = pending.nextStopName;
              state.eta = pending.eta;
              state.segmentStartTime = nowMs;
              state.filter.s = safeArclength(pending.prevS, state.lastRenderedS);  // Start from the station we just left
              state.lastRenderedS = state.filter.s;
              state.pendingSegment = undefined;
              state.dwellStartTime = undefined;
            }
          }

          // Update marker position at station
          const [lat, lon] = arclengthToLatLon!(state.filter.s, state.track);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            state.marker.setLngLat([lon, lat]);
          }
        } else {
          // Not at station - animate toward it
          // Clear dwell timer since we're moving
          state.dwellStartTime = undefined;

          // Use state machine if available
          if (state.animState) {
            // Dispatch TICK to state machine - handles all timing transitions
            // Non-null assertion safe: guarded by null check at outer scope (line 277)
            state.animState = trainAnimationReducer!(state.animState, {
              type: 'TICK',
              nowMs
            });

            // Get current position from state machine
            const currentS_sm = getCurrentArclength!(state.animState);
            let targetS_sm = safeArclength(currentS_sm, state.lastRenderedS, state.prevS);

            // Blend from rendered position toward state machine target
            const currentRendered = state.lastRenderedS ?? targetS_sm;

            // Monotonicity: never move backward — a still train is fine, a reversing train is not
            if (state.prevS <= state.nextS) {
              targetS_sm = Math.max(targetS_sm, currentRendered);
            } else {
              targetS_sm = Math.min(targetS_sm, currentRendered);
            }
            const blend_sm = 1 - Math.pow(1 - BLEND_SPEED, Math.max(0.5, frameDtMs / 16.67));
            state.filter.s = currentRendered + (targetS_sm - currentRendered) * blend_sm;
            if (Math.abs(state.filter.s - targetS_sm) < 1) {
              state.filter.s = targetS_sm;
            }
            if (!Number.isFinite(state.filter.s)) {
              state.filter.s = state.lastRenderedS ?? state.prevS;
            }
            state.lastRenderedS = state.filter.s;

            // Convert arclength to lat/lon
            const [lat, lon] = arclengthToLatLon!(state.filter.s, state.track);

            // Update marker position
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              state.marker.setLngLat([lon, lat]);
            }
          } else {
            // Fallback: schedule-based animation with smooth blending
            const adjustedDuration = state.scheduledDuration / Math.max(0.01, state.speedMultiplier);
            const elapsed = (nowMs - state.segmentStartTime) / 1000;
            const rawProgress = adjustedDuration > 0 ? elapsed / adjustedDuration : 1;
            const progress = Math.max(0, Math.min(1, rawProgress));

            // Calculate target position from schedule
            let targetS: number;
            if (progress >= 1.0) {
              targetS = state.nextS;
            } else {
              targetS = state.prevS + (state.nextS - state.prevS) * progress;
            }

            // Clamp target to segment bounds
            const minS = Math.min(state.prevS, state.nextS);
            const maxS = Math.max(state.prevS, state.nextS);
            targetS = Math.max(minS, Math.min(maxS, targetS));

            // NaN guard on target
            targetS = safeArclength(targetS, state.lastRenderedS, state.prevS);

            // Smooth blend from current rendered position toward target
            // Prevents teleportation on segment changes while tracking API data
            const currentS = state.lastRenderedS ?? targetS;

            // Monotonicity: never move backward — a still train is fine, a reversing train is not
            if (state.prevS <= state.nextS) {
              targetS = Math.max(targetS, currentS);
            } else {
              targetS = Math.min(targetS, currentS);
            }

            const dtNorm = Math.max(0.5, frameDtMs / 16.67);  // Normalize to 60fps
            const blend = 1 - Math.pow(1 - BLEND_SPEED, dtNorm);
            state.filter.s = currentS + (targetS - currentS) * blend;

            // Snap when very close to avoid asymptotic hover
            if (Math.abs(state.filter.s - targetS) < 1) {
              state.filter.s = targetS;
            }
            if (!Number.isFinite(state.filter.s)) {
              state.filter.s = state.lastRenderedS ?? state.prevS;
            }

            state.lastRenderedS = state.filter.s;

            const [lat, lon] = arclengthToLatLon!(state.filter.s, state.track);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              state.marker.setLngLat([lon, lat]);
            }
          }
        }

        // Check for phase change and update popup if needed
        const currentPhase = getPhaseFromDistance(state.filter.s, state.nextS);
        if (currentPhase !== state.lastPhase) {
          state.lastPhase = currentPhase;
          // getRouteColor is guaranteed non-null here (guarded by motionUtilsLoaded check above)
          const color = getRouteColor!(state.routeId);
          const html = buildTrainPopupHTML(state, color, currentPhase);
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
