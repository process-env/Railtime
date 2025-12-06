/**
 * Train Animation State Machine
 *
 * Manages train animation timing with clear states and transitions.
 * Uses a reducer pattern for predictable state updates.
 *
 * States:
 * - APPROACHING: Train traveling toward next station
 * - ARRIVING: Train within arrival threshold (progress > 0.95)
 * - AT_STATION: Train snapped to exact station position
 * - DEPARTING: Train just left station, beginning new segment
 */

export type TrainPhase = 'APPROACHING' | 'ARRIVING' | 'BOARDING';

export interface TrainAnimationState {
  // Identity
  tripId: string;
  routeId: string;

  // Current phase
  phase: TrainPhase;

  // Segment info
  prevStopId: string;
  nextStopId: string;
  prevS: number;  // Arclength of prev stop
  nextS: number;  // Arclength of next stop

  // Timing
  segmentStartTime: number;  // When train entered current segment (ms)
  scheduledDuration: number; // Expected duration from GTFS (seconds)
  speedMultiplier: number;   // Alert-based adjustment (0.5-1.0)

  // Current position
  currentS: number;          // Current arclength position
  progress: number;          // 0-1 progress through segment

  // Dwell tracking
  dwellStartTime: number | null;  // When train arrived at station
  dwellDuration: number;          // Expected dwell time (seconds)

  // Cached next segment (received while dwelling)
  pendingSegment: {
    prevStopId: string;
    nextStopId: string;
    prevS: number;
    nextS: number;
    apiProgress: number;
  } | null;

  // Sync
  lastApiUpdate: number;     // Last API update timestamp
  apiProgress: number;       // Progress from API (for sync comparison)
}

// Action types
export type TrainAction =
  | { type: 'TICK'; nowMs: number }
  | { type: 'API_UPDATE'; nowMs: number; prevStopId: string; nextStopId: string; prevS: number; nextS: number; apiProgress: number }
  | { type: 'SET_DURATION'; duration: number }
  | { type: 'SET_SPEED_MULTIPLIER'; multiplier: number }
  | { type: 'FORCE_SNAP'; s: number };

// Thresholds - use DISTANCE not progress
const ARRIVING_DISTANCE = 200;       // meters - show "Arriving" when within 200m of station
const STATION_SNAP_DISTANCE = 20;    // meters - SNAP to station when within 20m
const DWELL_DURATION_DEFAULT = 2;    // Default dwell time (seconds)
const SYNC_SNAP_THRESHOLD = 0.3;     // Snap if >30% discrepancy
const SYNC_ADJUST_THRESHOLD = 0.1;   // Adjust speed if 10-30% discrepancy

/**
 * Create initial animation state for a train
 */
export function createTrainAnimationState(
  tripId: string,
  routeId: string,
  prevStopId: string,
  nextStopId: string,
  prevS: number,
  nextS: number,
  nowMs: number,
  initialProgress: number = 0,
  scheduledDuration: number = 90,
  speedMultiplier: number = 1.0
): TrainAnimationState {
  const currentS = prevS + (nextS - prevS) * initialProgress;
  const animDuration = scheduledDuration / speedMultiplier;

  // Use DISTANCE to station for phase detection (not progress)
  const distanceToStation = Math.abs(nextS - currentS);
  const phase: TrainPhase = distanceToStation <= STATION_SNAP_DISTANCE ? 'BOARDING' :
                            distanceToStation <= ARRIVING_DISTANCE ? 'ARRIVING' : 'APPROACHING';

  return {
    tripId,
    routeId,
    phase,
    prevStopId,
    nextStopId,
    prevS,
    nextS,
    segmentStartTime: nowMs - (initialProgress * animDuration * 1000),
    scheduledDuration,
    speedMultiplier,
    currentS,
    progress: initialProgress,
    dwellStartTime: phase === 'BOARDING' ? nowMs : null,
    dwellDuration: DWELL_DURATION_DEFAULT,
    pendingSegment: null,
    lastApiUpdate: nowMs,
    apiProgress: initialProgress,
  };
}

/**
 * Train animation reducer - handles all state transitions
 */
export function trainAnimationReducer(
  state: TrainAnimationState,
  action: TrainAction
): TrainAnimationState {
  switch (action.type) {
    case 'TICK':
      return handleTick(state, action.nowMs);

    case 'API_UPDATE':
      return handleApiUpdate(state, action);

    case 'SET_DURATION':
      return { ...state, scheduledDuration: action.duration };

    case 'SET_SPEED_MULTIPLIER':
      return { ...state, speedMultiplier: action.multiplier };

    case 'FORCE_SNAP':
      return {
        ...state,
        currentS: action.s,
        progress: calculateProgress(state.prevS, state.nextS, action.s),
      };

    default:
      return state;
  }
}

/**
 * Handle animation tick - update position based on elapsed time
 */
function handleTick(state: TrainAnimationState, nowMs: number): TrainAnimationState {
  switch (state.phase) {
    case 'BOARDING': {
      // Train at station - check dwell time and pending segment
      if (state.dwellStartTime !== null) {
        const dwellElapsed = (nowMs - state.dwellStartTime) / 1000;

        // If we have pending segment AND dwell complete - START MOVING!
        if (state.pendingSegment && dwellElapsed >= state.dwellDuration) {
          const pending = state.pendingSegment;
          return {
            ...state,
            phase: 'APPROACHING',
            prevStopId: pending.prevStopId,
            nextStopId: pending.nextStopId,
            prevS: pending.prevS,
            nextS: pending.nextS,
            segmentStartTime: nowMs,
            currentS: pending.prevS,
            progress: 0,
            dwellStartTime: null,
            pendingSegment: null,
          };
        }

      }
      // Still boarding - stay at exact station position
      return {
        ...state,
        currentS: state.nextS,
        progress: 1.0,
      };
    }

    case 'APPROACHING':
    case 'ARRIVING': {
      // Calculate progress based on schedule
      const animDuration = state.scheduledDuration / state.speedMultiplier;
      const elapsed = (nowMs - state.segmentStartTime) / 1000;
      const rawProgress = animDuration > 0 ? elapsed / animDuration : 1;
      const progress = Math.max(0, Math.min(1, rawProgress));

      // Calculate position - direct lerp
      let currentS = state.prevS + (state.nextS - state.prevS) * progress;

      // Safety clamp
      const minS = Math.min(state.prevS, state.nextS);
      const maxS = Math.max(state.prevS, state.nextS);
      currentS = Math.max(minS, Math.min(maxS, currentS));

      // Use DISTANCE to detect phase (not progress percentage)
      const distanceToStation = Math.abs(state.nextS - currentS);

      if (distanceToStation <= STATION_SNAP_DISTANCE) {
        // SNAP to station - enter BOARDING
        return {
          ...state,
          phase: 'BOARDING',
          currentS: state.nextS,
          progress: 1.0,
          dwellStartTime: nowMs,
        };
      } else if (distanceToStation <= ARRIVING_DISTANCE) {
        return { ...state, phase: 'ARRIVING', currentS, progress };
      } else {
        return { ...state, phase: 'APPROACHING', currentS, progress };
      }
    }

    default:
      return state;
  }
}

/**
 * Handle API update - sync state with new data
 */
function handleApiUpdate(
  state: TrainAnimationState,
  action: { nowMs: number; prevStopId: string; nextStopId: string; prevS: number; nextS: number; apiProgress: number }
): TrainAnimationState {
  const { nowMs, prevStopId, nextStopId, prevS, nextS, apiProgress } = action;

  // Check if segment changed (train moved to new station pair)
  const segmentChanged =
    prevStopId !== state.prevStopId ||
    nextStopId !== state.nextStopId;

  if (segmentChanged) {
    // If train is BOARDING, cache the new segment - don't interrupt dwell
    if (state.phase === 'BOARDING') {
      return {
        ...state,
        pendingSegment: {
          prevStopId,
          nextStopId,
          prevS,
          nextS,
          apiProgress,
        },
        lastApiUpdate: nowMs,
        apiProgress,
      };
    }

    // Not boarding - immediate transition to new segment
    const initialS = prevS + (nextS - prevS) * apiProgress;

    // Calculate segmentStartTime BACKWARDS from apiProgress so animation continues smoothly
    // If apiProgress is 0.5 and duration is 90s, we started 45s ago
    const animDuration = state.scheduledDuration / state.speedMultiplier;
    const elapsedFromProgress = apiProgress * animDuration * 1000; // ms
    const calculatedStartTime = nowMs - elapsedFromProgress;

    // Use DISTANCE to detect phase (not progress percentage)
    const distanceToStation = Math.abs(nextS - initialS);
    const newPhase: TrainPhase = distanceToStation <= STATION_SNAP_DISTANCE ? 'BOARDING' :
                                  distanceToStation <= ARRIVING_DISTANCE ? 'ARRIVING' : 'APPROACHING';

    return {
      ...state,
      phase: newPhase,
      prevStopId,
      nextStopId,
      prevS,
      nextS,
      segmentStartTime: calculatedStartTime,
      currentS: initialS,
      progress: apiProgress,
      dwellStartTime: newPhase === 'BOARDING' ? nowMs : null,
      pendingSegment: null,
      lastApiUpdate: nowMs,
      apiProgress,
    };
  }

  // Same segment - check for sync discrepancy
  const segmentLength = Math.abs(state.nextS - state.prevS);

  if (segmentLength > 0) {
    // Calculate our expected position
    const adjustedDuration = state.scheduledDuration / state.speedMultiplier;
    const elapsed = (nowMs - state.segmentStartTime) / 1000;
    const ourProgress = Math.min(1, elapsed / adjustedDuration);

    // Calculate discrepancy
    const discrepancy = Math.abs(ourProgress - apiProgress);

    if (discrepancy > SYNC_SNAP_THRESHOLD) {
      // Large discrepancy (>30%) - SNAP to API position
      const newS = state.prevS + (state.nextS - state.prevS) * apiProgress;

      // Recalculate segment start time to match API progress
      const newSegmentStartTime = nowMs - (apiProgress * adjustedDuration * 1000);

      return {
        ...state,
        segmentStartTime: newSegmentStartTime,
        currentS: newS,
        progress: apiProgress,
        lastApiUpdate: nowMs,
        apiProgress,
      };
    } else if (discrepancy > SYNC_ADJUST_THRESHOLD) {
      // Moderate discrepancy (10-30%) - adjust speed to catch up
      const behindApi = ourProgress < apiProgress;
      const adjustment = 1 + (behindApi ? discrepancy : -discrepancy * 0.5);

      return {
        ...state,
        speedMultiplier: Math.max(0.5, Math.min(2.0, adjustment)),
        lastApiUpdate: nowMs,
        apiProgress,
      };
    }
    // Small discrepancy (<10%) - ignore, our animation is close enough
  }

  // Update tracking fields only
  return {
    ...state,
    lastApiUpdate: nowMs,
    apiProgress,
  };
}

/**
 * Calculate progress from arclength position
 */
function calculateProgress(prevS: number, nextS: number, currentS: number): number {
  const segmentLength = nextS - prevS;
  if (segmentLength === 0) return 0;
  return Math.max(0, Math.min(1, (currentS - prevS) / segmentLength));
}

/**
 * Get the current arclength from state (for rendering)
 */
export function getCurrentArclength(state: TrainAnimationState): number {
  return state.currentS;
}

/**
 * Check if train is at station (boarding)
 */
export function isAtStation(state: TrainAnimationState): boolean {
  return state.phase === 'BOARDING';
}

/**
 * Check if train is arriving (for pulsing indicator)
 */
export function isArriving(state: TrainAnimationState): boolean {
  return state.phase === 'ARRIVING';
}

/**
 * Get phase display string
 */
export function getPhaseLabel(state: TrainAnimationState): string {
  switch (state.phase) {
    case 'BOARDING': return 'Boarding';
    case 'ARRIVING': return 'Arriving';
    case 'APPROACHING': return 'En Route';
    default: return 'Unknown';
  }
}
