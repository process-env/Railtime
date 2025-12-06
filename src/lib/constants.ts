// Route colors for the MTA subway system
export const ROUTE_COLORS: Record<string, string> = {
  '1': '#EE352E',
  '2': '#EE352E',
  '3': '#EE352E',
  '4': '#00933C',
  '5': '#00933C',
  '6': '#00933C',
  '6X': '#00933C',
  '7': '#B933AD',
  '7X': '#B933AD',
  A: '#2850AD',
  C: '#2850AD',
  E: '#2850AD',
  B: '#FF6319',
  D: '#FF6319',
  F: '#FF6319',
  FX: '#FF6319',
  M: '#FF6319',
  G: '#6CBE45',
  J: '#996633',
  Z: '#996633',
  L: '#A7A9AC',
  N: '#FCCC0A',
  Q: '#FCCC0A',
  R: '#FCCC0A',
  W: '#FCCC0A',
  S: '#808183',
  FS: '#808183',
  GS: '#808183',
  H: '#808183',
  SI: '#0039A6',
  SIR: '#0039A6',
};

// NYC bounds for map
export const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.3, 40.4], // SW corner
  [-73.6, 41.0], // NE corner
];

// Default map center (Times Square area)
export const NYC_CENTER: [number, number] = [-73.9857, 40.7580];

// Feed group configurations
export const FEED_GROUPS = [
  { id: 'ACE', routes: ['A', 'C', 'E'], color: '#2850AD' },
  { id: 'BDFM', routes: ['B', 'D', 'F', 'M'], color: '#FF6319' },
  { id: 'G', routes: ['G'], color: '#6CBE45' },
  { id: 'JZ', routes: ['J', 'Z'], color: '#996633' },
  { id: 'NQRW', routes: ['N', 'Q', 'R', 'W'], color: '#FCCC0A' },
  { id: 'L', routes: ['L'], color: '#A7A9AC' },
  { id: 'SI', routes: ['SI', 'SIR'], color: '#0039A6' },
  { id: '1234567', routes: ['1', '2', '3', '4', '5', '6', '7', 'S'], color: '#EE352E' },
];

// All route IDs
export const ALL_ROUTES = [
  '1', '2', '3', '4', '5', '6', '7',
  'A', 'C', 'E', 'B', 'D', 'F', 'M',
  'G', 'J', 'Z', 'L',
  'N', 'Q', 'R', 'W',
  'GS', 'FS', 'H', 'SI', // GS=42nd St, FS=Franklin Ave, H=Rockaway, SI=Staten Island
];

export function getRouteColor(routeId: string): string {
  return ROUTE_COLORS[routeId.toUpperCase()] || '#888888';
}

// Map-related constants
export const MAP_CONSTANTS = {
  /** Minimum zoom level to show station markers */
  STATION_MIN_ZOOM: 12,
  /** Dwelling threshold - train moved < this distance (degrees) is considered stopped (~11 meters) */
  DWELLING_THRESHOLD: 0.0001,
  /** Popup offset for station markers */
  POPUP_OFFSET_STATION: 10,
  /** Popup offset for train markers */
  POPUP_OFFSET_TRAIN: 15,
  /** Train position refresh interval in milliseconds */
  REFRESH_INTERVAL: 15000,
  /** Trip ID display truncation length */
  TRIP_ID_DISPLAY_LENGTH: 20,
} as const;

// Alert display limits
export const ALERT_LIMITS = {
  /** Max routes shown in ticker */
  TICKER_ROUTES: 3,
  /** Max routes shown in card */
  CARD_ROUTES: 6,
  /** Max stations shown in card */
  CARD_STATIONS: 5,
} as const;

// Ticker animation settings
export const TICKER_SETTINGS = {
  /** Base animation duration in seconds per alert */
  BASE_DURATION_PER_ALERT: 8,
  /** Minimum animation duration in seconds */
  MIN_DURATION: 15,
  /** Maximum animation duration in seconds */
  MAX_DURATION: 120,
} as const;

// Severity colors - consolidated definitions
export const SEVERITY_COLORS = {
  critical: {
    bg: 'bg-red-600',
    bgLight: 'bg-red-500/10',
    text: 'text-red-500',
    textOnBg: 'text-white',
    badge: 'destructive' as const,
  },
  warning: {
    bg: 'bg-yellow-500',
    bgLight: 'bg-yellow-500/10',
    text: 'text-yellow-500',
    textOnBg: 'text-black',
    badge: 'secondary' as const,
  },
  info: {
    bg: 'bg-blue-500',
    bgLight: 'bg-blue-500/10',
    text: 'text-blue-500',
    textOnBg: 'text-white',
    badge: 'default' as const,
  },
} as const;

// Calculate ticker animation duration based on alert count
export function calculateTickerDuration(alertCount: number): number {
  const duration = alertCount * TICKER_SETTINGS.BASE_DURATION_PER_ALERT;
  return Math.max(
    TICKER_SETTINGS.MIN_DURATION,
    Math.min(TICKER_SETTINGS.MAX_DURATION, duration)
  );
}
