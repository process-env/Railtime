/**
 * α-β-γ Filter (Constant Acceleration Tracker)
 *
 * A predictive filter for smooth train position estimation.
 * Maintains state (s, v, a) and updates on measurements.
 *
 * The filter:
 * - Predicts position forward each frame using kinematics
 * - Corrects state when new measurements arrive
 * - Applies physical constraints (vmax, amax)
 *
 * Gains (α, β, γ) control smoothness vs responsiveness:
 * - Higher gains = more responsive, less smooth
 * - Lower gains = smoother, slower to correct
 */

export interface FilterState {
  s: number;      // Position (arclength in meters)
  v: number;      // Velocity (m/s)
  a: number;      // Acceleration (m/s²)
  lastUpdateTime: number; // ms timestamp
}

export interface FilterParams {
  alpha: number;  // Position correction gain (0.3-0.5 typical)
  beta: number;   // Velocity correction gain (0.1-0.2 typical)
  gamma: number;  // Acceleration correction gain (0.02-0.08 typical)
  vmax: number;   // Maximum velocity (m/s)
  amax: number;   // Maximum acceleration (m/s²)
}

// Default parameters tuned for ~15s sampling interval
export const DEFAULT_FILTER_PARAMS: FilterParams = {
  alpha: 0.35,
  beta: 0.15,
  gamma: 0.05,
  vmax: 20,    // ~72 km/h
  amax: 1.0    // comfortable subway acceleration
};

/**
 * Create initial filter state from a measurement
 */
export function createFilterState(
  initialS: number,
  initialV: number = 0,
  initialA: number = 0,
  timestamp: number = Date.now()
): FilterState {
  return {
    s: initialS,
    v: initialV,
    a: initialA,
    lastUpdateTime: timestamp
  };
}

/**
 * Predict state forward by dt seconds (kinematics)
 *
 * s' = s + v*dt + 0.5*a*dt²
 * v' = v + a*dt
 * a' = a (constant acceleration model)
 */
export function predict(
  state: FilterState,
  dt: number,
  params: FilterParams
): FilterState {
  if (dt <= 0) return state;

  let { s, v, a } = state;

  // Kinematic prediction
  s = s + v * dt + 0.5 * a * dt * dt;
  v = v + a * dt;
  // a remains constant in prediction phase

  // Apply velocity constraints
  v = clamp(v, -params.vmax, params.vmax);

  // Apply acceleration constraints
  a = clamp(a, -params.amax, params.amax);

  return {
    s,
    v,
    a,
    lastUpdateTime: state.lastUpdateTime + dt * 1000
  };
}

/**
 * Update state with a new measurement
 *
 * Uses α-β-γ correction:
 * s' = s + α * residual
 * v' = v + (β/ΔT) * residual
 * a' = a + (2γ/ΔT²) * residual
 *
 * where residual = measurement - predicted_s
 */
export function update(
  state: FilterState,
  measurement: number,
  measurementTime: number,
  params: FilterParams
): FilterState {
  // Time since last update (seconds)
  const dt = Math.max(0.001, (measurementTime - state.lastUpdateTime) / 1000);

  // Predict to measurement time
  const predicted = predict(state, dt, params);

  // Calculate residual (innovation)
  const residual = measurement - predicted.s;

  // Apply α-β-γ corrections
  let s = predicted.s + params.alpha * residual;
  let v = predicted.v + (params.beta / dt) * residual;
  let a = predicted.a + (2 * params.gamma / (dt * dt)) * residual;

  // Apply constraints
  v = clamp(v, -params.vmax, params.vmax);
  a = clamp(a, -params.amax, params.amax);

  return {
    s,
    v,
    a,
    lastUpdateTime: measurementTime
  };
}

/**
 * Predict position at a specific time without modifying state
 */
export function predictPosition(
  state: FilterState,
  targetTime: number,
  params: FilterParams
): number {
  const dt = (targetTime - state.lastUpdateTime) / 1000;
  if (dt <= 0) return state.s;

  // Kinematic prediction with velocity clamping
  let v = state.v + state.a * dt;
  v = clamp(v, -params.vmax, params.vmax);

  // Average velocity over interval
  const avgV = (state.v + v) / 2;
  return state.s + avgV * dt;
}

/**
 * Predict velocity at a specific time
 */
export function predictVelocity(
  state: FilterState,
  targetTime: number,
  params: FilterParams
): number {
  const dt = (targetTime - state.lastUpdateTime) / 1000;
  if (dt <= 0) return state.v;

  const v = state.v + state.a * dt;
  return clamp(v, -params.vmax, params.vmax);
}

/**
 * Reset filter state (e.g., on large discontinuity)
 */
export function resetFilter(
  state: FilterState,
  newS: number,
  newV: number = 0,
  newA: number = 0,
  timestamp: number = Date.now()
): FilterState {
  return {
    s: newS,
    v: newV,
    a: newA,
    lastUpdateTime: timestamp
  };
}

/**
 * Check if measurement represents a large discontinuity
 * (indicating route change, data error, etc.)
 */
export function isDiscontinuity(
  state: FilterState,
  measurement: number,
  measurementTime: number,
  params: FilterParams,
  threshold: number = 5000  // 5km default threshold
): boolean {
  const dt = (measurementTime - state.lastUpdateTime) / 1000;
  const predicted = predict(state, dt, params);

  const residual = Math.abs(measurement - predicted.s);

  // Check if residual is unreasonably large
  // Max possible distance at vmax
  const maxPossibleDistance = params.vmax * dt * 1.5; // 1.5x for safety margin

  return residual > Math.max(threshold, maxPossibleDistance);
}

/**
 * Blend filter state with a target value (for smooth corrections)
 */
export function blendState(
  state: FilterState,
  targetS: number,
  blendFactor: number = 0.1
): FilterState {
  return {
    ...state,
    s: state.s + blendFactor * (targetS - state.s)
  };
}

/**
 * Calculate optimal gains for a given sampling interval
 * Based on critical damping criteria
 */
export function calculateGains(
  samplingInterval: number  // seconds
): Pick<FilterParams, 'alpha' | 'beta' | 'gamma'> {
  // These formulas are derived from optimal filter theory
  // for critically damped response
  const T = samplingInterval;

  // Damping ratio (0.707 for critical damping)
  const zeta = 0.707;

  // Natural frequency (affects responsiveness)
  const wn = 1 / T;

  // Simplified gain calculations
  const alpha = 1 - Math.exp(-2 * zeta * wn * T);
  const beta = 2 * zeta * wn * T * Math.exp(-zeta * wn * T);
  const gamma = 0.5 * (wn * wn * T * T) * Math.exp(-zeta * wn * T);

  return {
    alpha: Math.min(0.5, Math.max(0.1, alpha)),
    beta: Math.min(0.3, Math.max(0.05, beta)),
    gamma: Math.min(0.1, Math.max(0.01, gamma))
  };
}

/**
 * Utility: clamp value to range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Debug: format filter state for logging
 */
export function formatState(state: FilterState): string {
  return `s=${state.s.toFixed(1)}m, v=${state.v.toFixed(2)}m/s, a=${state.a.toFixed(3)}m/s²`;
}
