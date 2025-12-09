/**
 * Build Route Segments Script
 *
 * Parses GTFS stop_times.txt to generate ordered stop sequences per route
 * with travel times between consecutive stops. This is used by the trip planner
 * to calculate travel times along routes.
 *
 * Run with: npx tsx scripts/build-route-segments.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'route-segments.json');

/**
 * Route segment edge (stop-to-stop travel time)
 */
interface SegmentEdge {
  from: string;
  to: string;
  seconds: number;
}

/**
 * Route segments for one direction
 */
interface RouteDirection {
  stops: string[];       // Ordered stop IDs
  edges: SegmentEdge[];  // Travel times between consecutive stops
}

/**
 * Route segments output
 */
interface RouteSegments {
  [routeId: string]: {
    directions: {
      [directionId: string]: RouteDirection;
    };
  };
}

/**
 * Output format
 */
interface RouteSegmentsOutput {
  routes: RouteSegments;
  meta: {
    generatedAt: string;
    routeCount: number;
    totalEdges: number;
  };
}

/**
 * Parse time string "HH:MM:SS" to seconds from midnight
 * Handles times > 24:00 for overnight trips
 */
function parseTimeToSeconds(timeStr: string): number {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Get parent station ID (remove N/S platform suffix)
 */
function getParentStationId(stopId: string): string {
  return stopId.replace(/[NS]$/, '');
}

async function buildRouteSegments() {
  console.log('Building route segments from GTFS data...');
  const startTime = Date.now();

  // Read files
  const tripsText = fs.readFileSync(path.join(DATA_DIR, 'trips.txt'), 'utf-8');
  const stopTimesText = fs.readFileSync(path.join(DATA_DIR, 'stop_times.txt'), 'utf-8');

  console.log(`  trips.txt: ${(tripsText.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  stop_times.txt: ${(stopTimesText.length / 1024 / 1024).toFixed(1)} MB`);

  // Parse trips.txt → Map<tripId, { routeId, directionId }>
  // Format: route_id,trip_id,service_id,trip_headsign,direction_id,shape_id
  const tripInfo = new Map<string, { routeId: string; directionId: string }>();
  const tripLines = tripsText.split('\n').slice(1);
  for (const line of tripLines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    const routeId = parts[0]?.trim();
    const tripId = parts[1]?.trim();
    const directionId = parts[4]?.trim() || '0';
    if (routeId && tripId) {
      tripInfo.set(tripId, { routeId, directionId });
    }
  }
  console.log(`  Parsed ${tripInfo.size} trips`);

  // Parse stop_times.txt and group by trip
  // Format: trip_id,stop_id,arrival_time,departure_time,stop_sequence
  const tripStops = new Map<string, Array<{ stopId: string; arrivalSec: number; seq: number }>>();
  const stopTimesLines = stopTimesText.split('\n').slice(1);
  let lineCount = 0;
  for (const line of stopTimesLines) {
    if (!line.trim()) continue;
    lineCount++;
    const parts = line.split(',');
    const tripId = parts[0]?.trim();
    const stopId = parts[1]?.trim();
    const arrivalTime = parts[2]?.trim();
    const seq = parseInt(parts[4]?.trim() || '0', 10);

    if (!tripId || !stopId || !arrivalTime) continue;

    const arrivalSec = parseTimeToSeconds(arrivalTime);
    if (!tripStops.has(tripId)) {
      tripStops.set(tripId, []);
    }
    tripStops.get(tripId)!.push({ stopId, arrivalSec, seq });
  }
  console.log(`  Parsed ${lineCount} stop_times entries`);

  // Build route segments by analyzing trips
  // For each route+direction, collect:
  // 1. Stop sequences (to find most common pattern)
  // 2. Travel times between stops

  // Map: routeId → directionId → fromStopId → toStopId → durations[]
  const durationData: Map<string, Map<string, Map<string, Map<string, number[]>>>> = new Map();

  // Map: routeId → directionId → stop sequence patterns (as string) → count
  const patternCounts: Map<string, Map<string, Map<string, number>>> = new Map();

  for (const [tripId, stops] of tripStops) {
    const info = tripInfo.get(tripId);
    if (!info) continue;

    const { routeId, directionId } = info;

    // Sort by sequence
    stops.sort((a, b) => a.seq - b.seq);

    // Get parent station IDs
    const parentStops = stops.map(s => getParentStationId(s.stopId));

    // Create pattern key
    const patternKey = parentStops.join(',');

    // Count pattern
    if (!patternCounts.has(routeId)) {
      patternCounts.set(routeId, new Map());
    }
    if (!patternCounts.get(routeId)!.has(directionId)) {
      patternCounts.get(routeId)!.set(directionId, new Map());
    }
    const counts = patternCounts.get(routeId)!.get(directionId)!;
    counts.set(patternKey, (counts.get(patternKey) || 0) + 1);

    // Collect durations between consecutive stops
    for (let i = 0; i < stops.length - 1; i++) {
      const from = getParentStationId(stops[i].stopId);
      const to = getParentStationId(stops[i + 1].stopId);
      let duration = stops[i + 1].arrivalSec - stops[i].arrivalSec;

      // Handle overnight trips
      if (duration < 0) duration += 86400;

      // Skip invalid durations
      if (duration <= 0 || duration > 1800) continue; // Max 30 min between stops

      // Store duration
      if (!durationData.has(routeId)) {
        durationData.set(routeId, new Map());
      }
      if (!durationData.get(routeId)!.has(directionId)) {
        durationData.get(routeId)!.set(directionId, new Map());
      }
      if (!durationData.get(routeId)!.get(directionId)!.has(from)) {
        durationData.get(routeId)!.get(directionId)!.set(from, new Map());
      }
      const toMap = durationData.get(routeId)!.get(directionId)!.get(from)!;
      if (!toMap.has(to)) {
        toMap.set(to, []);
      }
      toMap.get(to)!.push(duration);
    }
  }

  // Build output: for each route+direction, use most common stop pattern
  const routes: RouteSegments = {};
  let totalEdges = 0;

  for (const [routeId, directionMap] of patternCounts) {
    routes[routeId] = { directions: {} };

    for (const [directionId, patterns] of directionMap) {
      // Find most common pattern
      let bestPattern = '';
      let bestCount = 0;
      for (const [pattern, count] of patterns) {
        if (count > bestCount) {
          bestCount = count;
          bestPattern = pattern;
        }
      }

      if (!bestPattern) continue;

      const stops = bestPattern.split(',');
      const edges: SegmentEdge[] = [];

      // Get average durations for each edge
      const durations = durationData.get(routeId)?.get(directionId);
      if (durations) {
        for (let i = 0; i < stops.length - 1; i++) {
          const from = stops[i];
          const to = stops[i + 1];
          const times = durations.get(from)?.get(to);
          if (times && times.length > 0) {
            const avgSeconds = Math.round(
              times.reduce((a, b) => a + b, 0) / times.length
            );
            edges.push({ from, to, seconds: avgSeconds });
            totalEdges++;
          }
        }
      }

      routes[routeId].directions[directionId] = {
        stops,
        edges
      };
    }
  }

  // Build output
  const output: RouteSegmentsOutput = {
    routes,
    meta: {
      generatedAt: new Date().toISOString(),
      routeCount: Object.keys(routes).length,
      totalEdges
    }
  };

  // Write output (without pretty printing to save space)
  const outputJson = JSON.stringify(output);
  fs.writeFileSync(OUTPUT_FILE, outputJson);

  const elapsed = Date.now() - startTime;
  console.log(`\nDone in ${elapsed}ms`);
  console.log(`  Routes: ${Object.keys(routes).length}`);
  console.log(`  Total edges: ${totalEdges}`);
  console.log(`  Output: ${(outputJson.length / 1024).toFixed(1)} KB → ${OUTPUT_FILE}`);
}

buildRouteSegments().catch(console.error);
