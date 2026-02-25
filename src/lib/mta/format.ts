/**
 * Shared formatting utilities for MTA data display
 */

/**
 * Extract direction from stop ID suffix
 * MTA child stop IDs end with 'N' (northbound) or 'S' (southbound)
 * e.g., "101N" -> "N", "101S" -> "S", "101" -> null
 */
export function getDirectionFromStopId(stopId: string): 'N' | 'S' | null {
  if (!stopId) return null;
  const lastChar = stopId.slice(-1).toUpperCase();
  if (lastChar === 'N') return 'N';
  if (lastChar === 'S') return 'S';
  return null;
}

/**
 * Format ETA for display as relative time
 * @param eta - ISO date string
 * @param format - 'short' returns "1 min", 'long' returns "1 minute"
 */
export function formatEta(eta: string, format: 'short' | 'long' = 'short'): string {
  if (!eta) return 'Unknown';
  try {
    const etaDate = new Date(eta);
    // Check for invalid date
    if (isNaN(etaDate.getTime())) return eta;

    const now = new Date();
    const diffMs = etaDate.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins <= 0) return format === 'short' ? 'Arriving' : 'Arriving now';
    if (diffMins === 1) return format === 'short' ? '1 min' : '1 minute';
    return format === 'short' ? `${diffMins} mins` : `${diffMins} minutes`;
  } catch {
    return eta;
  }
}

/**
 * Format ETA as absolute time (e.g., "3:45 PM")
 */
export function formatTime(eta: string): string {
  if (!eta) return '--:--';
  try {
    const date = new Date(eta);
    // Check for invalid date
    if (isNaN(date.getTime())) return '--:--';

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '--:--';
  }
}

/**
 * Get human-readable direction label
 */
export function getDirectionLabel(direction: 'N' | 'S' | null): string {
  if (direction === 'N') return 'Northbound';
  if (direction === 'S') return 'Southbound';
  return 'Unknown';
}

/**
 * Get appropriate text color for a background color
 * Returns black for yellow backgrounds (NQRW line), white for all others
 */
export function getTextColorForBackground(bgColor: string): string {
  return bgColor.toUpperCase() === '#FCCC0A' ? '#000' : '#fff';
}

/**
 * Truncate string with ellipsis if longer than maxLength
 */
export function truncateWithEllipsis(str: string, maxLength: number): string {
  if (!str) return '';
  return str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
}

/**
 * Route terminal destinations for direction-aware headsign
 * N = Northbound/Uptown terminal, S = Southbound/Downtown terminal
 */
const ROUTE_TERMINALS: Record<string, { N: string; S: string }> = {
  // IRT 7th Ave / Broadway
  '1': { N: 'Van Cortlandt Park-242 St', S: 'South Ferry' },
  '2': { N: '241 St', S: 'Flatbush Av-Brooklyn College' },
  '3': { N: 'Harlem-148 St', S: 'New Lots Av' },
  // IRT Lexington Ave
  '4': { N: 'Woodlawn', S: 'Crown Heights-Utica Av' },
  '5': { N: 'Eastchester-Dyre Av', S: 'Flatbush Av-Brooklyn College' },
  '6': { N: 'Pelham Bay Park', S: 'Brooklyn Bridge-City Hall' },
  '6X': { N: 'Pelham Bay Park', S: 'Brooklyn Bridge-City Hall' },
  // IRT Flushing
  '7': { N: 'Flushing-Main St', S: '34 St-Hudson Yards' },
  '7X': { N: 'Flushing-Main St', S: '34 St-Hudson Yards' },
  // BMT Nassau St / Jamaica
  'J': { N: 'Jamaica Center', S: 'Broad St' },
  'Z': { N: 'Jamaica Center', S: 'Broad St' },
  // BMT Canarsie
  'L': { N: '8 Av', S: 'Canarsie-Rockaway Pkwy' },
  // BMT Broadway
  'N': { N: 'Astoria-Ditmars Blvd', S: 'Coney Island-Stillwell Av' },
  'Q': { N: '96 St', S: 'Coney Island-Stillwell Av' },
  'R': { N: 'Forest Hills-71 Av', S: 'Bay Ridge-95 St' },
  'W': { N: 'Astoria-Ditmars Blvd', S: 'Whitehall St' },
  // IND 8th Ave
  'A': { N: 'Inwood-207 St', S: 'Far Rockaway/Ozone Park' },
  'C': { N: '168 St', S: 'Euclid Av' },
  'E': { N: 'Jamaica Center', S: 'World Trade Center' },
  // IND 6th Ave
  'B': { N: 'Bedford Park Blvd', S: 'Brighton Beach' },
  'D': { N: 'Norwood-205 St', S: 'Coney Island-Stillwell Av' },
  'F': { N: 'Jamaica-179 St', S: 'Coney Island-Stillwell Av' },
  'FX': { N: 'Jamaica-179 St', S: 'Coney Island-Stillwell Av' },
  'M': { N: 'Forest Hills-71 Av', S: 'Middle Village-Metropolitan Av' },
  // IND Crosstown
  'G': { N: 'Court Sq', S: 'Church Av' },
  // Shuttles
  'S': { N: 'Times Sq-42 St', S: 'Grand Central-42 St' },
  'FS': { N: 'Franklin Av', S: 'Prospect Park' },
  'GS': { N: 'Times Sq-42 St', S: 'Grand Central-42 St' },
  'H': { N: 'Broad Channel', S: 'Rockaway Park' },
  'SI': { N: 'St George', S: 'Tottenville' },
};

/**
 * Get headsign for a route based on direction
 * Used when the trip database headsign doesn't match the actual direction
 */
export function getHeadsignForDirection(
  routeId: string,
  direction: 'N' | 'S' | null
): string | null {
  if (!routeId) return null;
  const terminals = ROUTE_TERMINALS[routeId.toUpperCase()];
  if (!terminals || !direction) return null;
  return terminals[direction];
}

/**
 * Validate and correct headsign based on actual direction of travel
 * If the headsign doesn't match the direction from nextStopId, use the terminal map
 */
export function validateHeadsign(
  headsign: string | null,
  nextStopId: string,
  routeId: string
): string {
  const direction = getDirectionFromStopId(nextStopId);

  // If we have a direction and can determine the correct terminal
  if (direction) {
    const correctTerminal = getHeadsignForDirection(routeId, direction);
    if (correctTerminal) {
      // If headsign is missing or doesn't match direction, use the terminal
      if (!headsign) {
        return correctTerminal;
      }

      // Check if headsign matches the expected terminal (case-insensitive partial match)
      const terminals = routeId ? ROUTE_TERMINALS[routeId.toUpperCase()] : undefined;
      if (terminals) {
        // If headsign matches the OPPOSITE direction's terminal, it's wrong
        const oppositeDir = direction === 'N' ? 'S' : 'N';
        const oppositeTerminal = terminals[oppositeDir];
        if (oppositeTerminal && headsign.toLowerCase().includes(oppositeTerminal.toLowerCase().split('-')[0].split(' ')[0])) {
          // Headsign matches opposite direction - use correct terminal
          return correctTerminal;
        }
      }
    }
  }

  // Return original headsign if we can't validate
  return headsign || 'Unknown';
}
