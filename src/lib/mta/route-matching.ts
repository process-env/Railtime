import type { Stop } from '@/types/mta';

// Route matching rules for stop ID heuristics
const ROUTE_RULES: Record<string, { prefixes?: string[]; ranges?: [number, number][] }> = {
  '1': { ranges: [[101, 142]] },
  '2': { ranges: [[201, 247], [301, 301]] },
  '3': { ranges: [[301, 302]] },
  '4': { ranges: [[401, 423], [621, 640]] },
  '5': { ranges: [[201, 247], [401, 423], [501, 532]] },
  '6': { ranges: [[601, 640]] },
  '7': { ranges: [[701, 726]] },
  A: { prefixes: ['A'], ranges: [[101, 199]] },
  C: { prefixes: ['A'] },
  E: { prefixes: ['E', 'F'] },
  B: { prefixes: ['D'] },
  D: { prefixes: ['D'] },
  F: { prefixes: ['F'] },
  M: { prefixes: ['M'] },
  G: { prefixes: ['G'] },
  J: { prefixes: ['J', 'M'] },
  Z: { prefixes: ['J', 'M'] },
  L: { prefixes: ['L'] },
  N: { prefixes: ['N', 'R'], ranges: [[1, 45]] },
  Q: { prefixes: ['Q', 'D', 'R'], ranges: [[13, 45]] },
  R: { prefixes: ['R'], ranges: [[1, 45]] },
  W: { prefixes: ['N', 'R'], ranges: [[1, 27]] },
  S: { prefixes: ['S', 'H'] },
  SI: { prefixes: ['S'] },
};

// Tokenized route cache
const tokenCache = new Map<string, string[]>();

function tokenize(str: string): string[] {
  const key = str.toUpperCase();
  if (tokenCache.has(key)) return tokenCache.get(key)!;
  const tokens = key.split(/[\s,/]+/).filter(Boolean);
  tokenCache.set(key, tokens);
  return tokens;
}

export function normalizeRoute(routeId: string): string {
  const upper = routeId.toUpperCase();
  // Normalize express variants
  if (upper === '5X') return '5';
  if (upper === '6X') return '6';
  if (upper === '7X') return '7';
  if (upper === 'FX') return 'F';
  if (upper === 'GS') return 'S';
  if (upper === 'FS') return 'S';
  if (upper === 'SIR') return 'SI';
  return upper;
}

export function stopServesRoute(stop: Stop, routeId: string): boolean {
  const normalizedRoute = normalizeRoute(routeId);

  // 1. Check explicit routes field
  if (stop.routes) {
    const tokens = tokenize(stop.routes);
    if (tokens.includes(normalizedRoute)) return true;
  }

  // 2. Check stop ID heuristics
  const rules = ROUTE_RULES[normalizedRoute];
  if (!rules) return false;

  const stopId = stop.id.toUpperCase();

  // Check prefix matches
  if (rules.prefixes) {
    for (const prefix of rules.prefixes) {
      if (stopId.startsWith(prefix)) return true;
    }
  }

  // Check numeric range matches
  if (rules.ranges) {
    // Extract numeric part from stop ID
    const numMatch = stopId.match(/^(\d+)/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      for (const [min, max] of rules.ranges) {
        if (num >= min && num <= max) return true;
      }
    }

    // Also check R-prefixed stops for NQRW
    const rMatch = stopId.match(/^R(\d+)/);
    if (rMatch) {
      const num = parseInt(rMatch[1], 10);
      for (const [min, max] of rules.ranges) {
        if (num >= min && num <= max) return true;
      }
    }
  }

  return false;
}

export function filterStopsByRoute(stops: Stop[], routeId: string): Stop[] {
  return stops.filter((stop) => stopServesRoute(stop, routeId));
}

export function getRoutesForStop(stop: Stop): string[] {
  const routes: string[] = [];

  // First add explicit routes
  if (stop.routes) {
    routes.push(...tokenize(stop.routes));
  }

  // Then infer from stop ID
  for (const [routeId, rules] of Object.entries(ROUTE_RULES)) {
    if (routes.includes(routeId)) continue;

    const stopId = stop.id.toUpperCase();

    if (rules.prefixes) {
      for (const prefix of rules.prefixes) {
        if (stopId.startsWith(prefix)) {
          routes.push(routeId);
          break;
        }
      }
    }
  }

  return [...new Set(routes)];
}
