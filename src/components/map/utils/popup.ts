/**
 * Shared popup HTML builder for train markers.
 *
 * Both useTrainMarkers and useMapAnimation need to generate train popup HTML
 * with the same visual layout: route badge, destination, next station, and
 * phase indicator. This module provides the single canonical implementation
 * to avoid drift between the two.
 */

import { getDirectionFromStopId, formatEta, getDirectionLabel, getTextColorForBackground } from '@/lib/mta/format';

/**
 * Distance thresholds for train phase detection (in meters).
 * Duplicated from train-state-machine.ts for popup-level phase derivation.
 */
const ARRIVING_DISTANCE = 200;
const STATION_SNAP_DISTANCE = 20;

/**
 * Inputs for building train popup HTML.
 * Accepts minimal fields so both TrainPosition and TrainMotionState can satisfy it.
 */
export interface TrainPopupData {
  routeId: string;
  nextStopId: string;
  nextStopName: string;
  eta: string;
  headsign?: string;
}

/**
 * Derives the train phase from arclength distance to the next station.
 *
 * @param currentS - Current arclength position of the train (meters)
 * @param nextS - Arclength of the next station (meters)
 * @returns The derived phase string
 */
export function derivePhaseFromDistance(
  currentS: number,
  nextS: number
): 'BOARDING' | 'ARRIVING' | 'APPROACHING' {
  const distance = Math.abs(nextS - currentS);
  if (distance <= STATION_SNAP_DISTANCE) return 'BOARDING';
  if (distance <= ARRIVING_DISTANCE) return 'ARRIVING';
  return 'APPROACHING';
}

/**
 * Derives the train phase from ETA (fallback for legacy trains without arclength data).
 */
function derivePhaseFromEta(eta: string): 'BOARDING' | 'ARRIVING' | 'APPROACHING' {
  try {
    const etaDate = new Date(eta);
    if (!isNaN(etaDate.getTime())) {
      const diffMs = etaDate.getTime() - Date.now();
      const diffMins = Math.round(diffMs / 60000);
      if (diffMins <= 0) return 'BOARDING';
      if (diffMins === 1) return 'ARRIVING';
      return 'APPROACHING';
    }
  } catch {
    // Fall through
  }
  return 'APPROACHING';
}

/**
 * Builds the popup HTML for a train marker.
 *
 * Phase can be provided directly (animation loop already knows it),
 * derived from arclength distance, or derived from ETA as a fallback.
 *
 * @param data - Train data (routeId, stops, ETA, headsign)
 * @param color - Route color hex string for the badge
 * @param phase - If provided, used directly. Otherwise derived from arclength or ETA.
 * @param currentS - Current arclength for distance-based phase derivation
 * @param nextS - Next station arclength for distance-based phase derivation
 * @returns HTML string suitable for MapLibre popup.setHTML()
 */
export function buildTrainPopupHTML(
  data: TrainPopupData,
  color: string,
  phase?: 'BOARDING' | 'ARRIVING' | 'APPROACHING',
  currentS?: number,
  nextS?: number
): string {
  const direction = getDirectionFromStopId(data.nextStopId);
  const destinationLabel = data.headsign || getDirectionLabel(direction);

  // Determine phase: explicit > distance-based > ETA-based
  let derivedPhase: 'BOARDING' | 'ARRIVING' | 'APPROACHING';
  if (phase) {
    derivedPhase = phase;
  } else if (currentS !== undefined && nextS !== undefined) {
    derivedPhase = derivePhaseFromDistance(currentS, nextS);
  } else if (data.eta) {
    derivedPhase = derivePhaseFromEta(data.eta);
  } else {
    derivedPhase = 'APPROACHING';
  }

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
        ">${data.routeId}</div>
        <span style="color: #888; font-size: 12px;">${destinationLabel}</span>
      </div>
      <div style="color: white; font-size: 13px; margin-bottom: 4px;">
        <strong>Next:</strong> ${data.nextStopName || 'Unknown'}
      </div>
      <div style="color: ${phaseColor}; font-size: 13px; font-weight: 600;">
        ${derivedPhase === 'BOARDING' ? 'At Station' :
          derivedPhase === 'ARRIVING' ? 'Arriving' :
          'En Route · ' + formatEta(data.eta)}
      </div>
    </div>
  `;
}
