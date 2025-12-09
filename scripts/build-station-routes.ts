/**
 * Build Station Routes Mapping
 *
 * Creates a JSON file mapping each station ID to the routes that serve it.
 * This is used by the trip planner search to show which lines serve each station.
 *
 * Run with: npx tsx scripts/build-station-routes.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'station-routes.json');

interface RouteSegmentsData {
  routes: {
    [routeId: string]: {
      directions: {
        [directionId: string]: {
          stops: string[];
        };
      };
    };
  };
}

async function buildStationRoutes() {
  console.log('Building station routes mapping...');
  const startTime = Date.now();

  // Load route segments
  const segmentsText = fs.readFileSync(path.join(DATA_DIR, 'route-segments.json'), 'utf-8');
  const segmentsData: RouteSegmentsData = JSON.parse(segmentsText);

  // Build station to routes mapping
  const stationRoutes: Record<string, string[]> = {};

  for (const [routeId, routeData] of Object.entries(segmentsData.routes)) {
    // Skip express variants for cleaner display
    if (routeId.endsWith('X')) continue;

    for (const direction of Object.values(routeData.directions)) {
      for (const stopId of direction.stops) {
        if (!stationRoutes[stopId]) {
          stationRoutes[stopId] = [];
        }
        if (!stationRoutes[stopId].includes(routeId)) {
          stationRoutes[stopId].push(routeId);
        }
      }
    }
  }

  // Sort routes for each station (numbers first, then letters)
  for (const stopId of Object.keys(stationRoutes)) {
    stationRoutes[stopId].sort((a, b) => {
      const aNum = parseInt(a);
      const bNum = parseInt(b);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      if (!isNaN(aNum)) return -1;
      if (!isNaN(bNum)) return 1;
      return a.localeCompare(b);
    });
  }

  // Write output
  const output = {
    stationRoutes,
    meta: {
      generatedAt: new Date().toISOString(),
      stationCount: Object.keys(stationRoutes).length,
    }
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));

  const elapsed = Date.now() - startTime;
  console.log(`\nDone in ${elapsed}ms`);
  console.log(`  Stations with routes: ${Object.keys(stationRoutes).length}`);
  console.log(`  Output: ${OUTPUT_FILE}`);
}

buildStationRoutes().catch(console.error);
