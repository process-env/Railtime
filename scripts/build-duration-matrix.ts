/**
 * Build Duration Matrix Script
 *
 * Pre-computes travel times between consecutive stops from GTFS data
 * and outputs a compact JSON file for use in the browser.
 *
 * Run with: npx ts-node scripts/build-duration-matrix.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'duration-matrix.json');

/**
 * Parse time string "HH:MM:SS" to seconds from midnight
 */
function parseTimeToSeconds(timeStr: string): number {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

async function buildMatrix() {
  console.log('Building duration matrix from GTFS data...');
  const startTime = Date.now();

  // Read files
  const tripsText = fs.readFileSync(path.join(DATA_DIR, 'trips.txt'), 'utf-8');
  const stopTimesText = fs.readFileSync(path.join(DATA_DIR, 'stop_times.txt'), 'utf-8');

  console.log(`  trips.txt: ${(tripsText.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  stop_times.txt: ${(stopTimesText.length / 1024 / 1024).toFixed(1)} MB`);

  // Parse trips.txt → Map<tripId, routeId>
  // Format: route_id,trip_id,service_id,trip_headsign,direction_id,shape_id
  const tripToRoute = new Map<string, string>();
  const tripLines = tripsText.split('\n').slice(1);
  for (const line of tripLines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    const routeId = parts[0]?.trim();
    const tripId = parts[1]?.trim(); // trip_id is at index 1
    if (routeId && tripId) {
      tripToRoute.set(tripId, routeId);
    }
  }
  console.log(`  Parsed ${tripToRoute.size} trips`);

  // Parse stop_times.txt and group by trip
  const tripStops = new Map<string, Array<{ stopId: string; arrivalSec: number; seq: number }>>();
  const stopTimesLines = stopTimesText.split('\n').slice(1);
  let lineCount = 0;
  for (const line of stopTimesLines) {
    if (!line.trim()) continue;
    lineCount++;
    const parts = line.split(',');
    const tripId = parts[0]?.trim();
    const arrivalTime = parts[1]?.trim();
    const stopId = parts[3]?.trim();
    const seq = parseInt(parts[4]?.trim() || '0', 10);

    if (!tripId || !stopId || !arrivalTime) continue;

    const arrivalSec = parseTimeToSeconds(arrivalTime);
    if (!tripStops.has(tripId)) {
      tripStops.set(tripId, []);
    }
    tripStops.get(tripId)!.push({ stopId, arrivalSec, seq });
  }
  console.log(`  Parsed ${lineCount} stop_times entries`);

  // Build matrix: for each trip, calculate duration between consecutive stops
  const routeDurations: Map<string, Map<string, Map<string, number[]>>> = new Map();

  for (const [tripId, stops] of tripStops) {
    const routeId = tripToRoute.get(tripId);
    if (!routeId) continue;

    // Sort by sequence
    stops.sort((a, b) => a.seq - b.seq);

    // Calculate durations between consecutive stops
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to = stops[i + 1];
      let duration = to.arrivalSec - from.arrivalSec;

      // Handle overnight trips
      if (duration < 0) duration += 86400;

      // Skip invalid durations
      if (duration <= 0 || duration > 1800) continue;

      if (!routeDurations.has(routeId)) {
        routeDurations.set(routeId, new Map());
      }
      const fromMap = routeDurations.get(routeId)!;
      if (!fromMap.has(from.stopId)) {
        fromMap.set(from.stopId, new Map());
      }
      const toMap = fromMap.get(from.stopId)!;
      if (!toMap.has(to.stopId)) {
        toMap.set(to.stopId, []);
      }
      toMap.get(to.stopId)!.push(duration);
    }
  }

  // Average durations and convert to compact format
  // Format: { routeId: [[fromStop, toStop, avgSeconds], ...], ... }
  // This is more compact than "fromStop:toStop": avgSeconds
  const matrix: Record<string, Array<[string, string, number]>> = {};
  let segmentCount = 0;

  for (const [routeId, fromMap] of routeDurations) {
    matrix[routeId] = [];
    for (const [fromStop, toMap] of fromMap) {
      for (const [toStop, durations] of toMap) {
        const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
        matrix[routeId].push([fromStop, toStop, avg]);
        segmentCount++;
      }
    }
  }

  // Write output without pretty printing
  const output = JSON.stringify(matrix);
  fs.writeFileSync(OUTPUT_FILE, output);

  const elapsed = Date.now() - startTime;
  const outputSize = (output.length / 1024).toFixed(1);
  console.log(`\nDone in ${elapsed}ms`);
  console.log(`  Routes: ${Object.keys(matrix).length}`);
  console.log(`  Segments: ${segmentCount}`);
  console.log(`  Output: ${outputSize} KB → ${OUTPUT_FILE}`);
}

buildMatrix().catch(console.error);
