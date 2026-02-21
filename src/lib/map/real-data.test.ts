/**
 * Real Data Test - Uses actual stops.txt and GeoJSON from public folder
 * Run with: npx vitest run src/lib/map/real-data.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createTrainAnimationState,
  trainAnimationReducer,
} from './train-state-machine';

// Haversine distance (copied from track-index.ts)
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Parse real stops.txt
function parseStops(csvText: string): Map<string, { lat: number; lon: number; name: string }> {
  const stops = new Map();
  const lines = csvText.trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 4) {
      const stopId = parts[0].trim();
      const name = parts[1].trim();
      const lat = parseFloat(parts[2]);
      const lon = parseFloat(parts[3]);
      if (!isNaN(lat) && !isNaN(lon)) {
        stops.set(stopId, { lat, lon, name });
      }
    }
  }
  return stops;
}

// Compute cumulative distances
function computeCumulativeDistances(coords: [number, number][]): number[] {
  const cumDists: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dist = haversineDistance(lat1, lon1, lat2, lon2);
    cumDists.push(cumDists[i - 1] + dist);
  }
  return cumDists;
}

// Project point to track
function projectPointToTrack(lat: number, lon: number, coords: [number, number][], cumDists: number[]): { arclength: number; distance: number } {
  let minDist = Infinity;
  let bestS = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq === 0) continue;

    const t = Math.max(0, Math.min(1, ((lon - lon1) * dx + (lat - lat1) * dy) / segLenSq));
    const closeLon = lon1 + t * dx;
    const closeLat = lat1 + t * dy;
    const dist = haversineDistance(lat, lon, closeLat, closeLon);

    if (dist < minDist) {
      minDist = dist;
      const segLen = cumDists[i + 1] - cumDists[i];
      bestS = cumDists[i] + t * segLen;
    }
  }

  return { arclength: bestS, distance: minDist };
}

describe('Real MTA Data Test', () => {
  // Load real files
  const publicDir = path.join(process.cwd(), 'public');
  const stopsPath = path.join(publicDir, 'data', 'stops.txt');
  const geojsonPath = path.join(publicDir, 'map', 'nyc-subway-lines.geojson');

  it('loads and displays real stops.txt data', () => {
    const stopsText = fs.readFileSync(stopsPath, 'utf-8');
    const stops = parseStops(stopsText);

    console.log('\n=== REAL STOPS.TXT DATA ===');
    console.log(`Total stops loaded: ${stops.size}`);
    console.log('\nFirst 20 stops:');
    console.log('stop_id,name,lat,lon');

    let count = 0;
    for (const [stopId, data] of stops) {
      if (count++ >= 20) break;
      console.log(`${stopId},${data.name},${data.lat},${data.lon}`);
    }

    expect(stops.size).toBeGreaterThan(0);
  });

  it('loads and displays real GeoJSON routes', () => {
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    console.log('\n=== REAL GEOJSON ROUTES ===');
    console.log(`Total features: ${geojson.features.length}`);
    console.log('\nRoutes found:');
    console.log('route_id,num_coords,total_length_meters');

    for (const feature of geojson.features) {
      const routeId = feature.properties?.route_id;
      if (!routeId || feature.geometry.type !== 'MultiLineString') continue;

      // Get longest segment
      let longestCoords: [number, number][] = [];
      for (const segment of feature.geometry.coordinates) {
        if (segment.length > longestCoords.length) {
          longestCoords = segment;
        }
      }

      const cumDists = computeCumulativeDistances(longestCoords);
      const totalLength = cumDists[cumDists.length - 1];

      console.log(`${routeId},${longestCoords.length},${totalLength.toFixed(0)}`);
    }

    expect(geojson.features.length).toBeGreaterThan(0);
  });

  it('computes real arclengths for R train stops', () => {
    const stopsText = fs.readFileSync(stopsPath, 'utf-8');
    const stops = parseStops(stopsText);

    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    // Find R route
    const rFeature = geojson.features.find((f: { properties?: { route_id?: string } }) => f.properties?.route_id === 'R');
    if (!rFeature) {
      console.log('R route not found in GeoJSON');
      return;
    }

    // Get longest segment
    let coords: [number, number][] = [];
    for (const segment of rFeature.geometry.coordinates) {
      if (segment.length > coords.length) {
        coords = segment;
      }
    }

    const cumDists = computeCumulativeDistances(coords);
    const totalLength = cumDists[cumDists.length - 1];

    console.log('\n=== REAL R TRAIN STOP ARCLENGTHS ===');
    console.log(`R route total length: ${totalLength.toFixed(0)} meters`);
    console.log('\nstop_id,name,lat,lon,arclength_m,dist_to_track_m');

    // Find R stops (start with R in stop_id)
    const rStops: Array<{ stopId: string; name: string; lat: number; lon: number; arclength: number; distance: number }> = [];

    for (const [stopId, data] of stops) {
      if (stopId.startsWith('R') && !stopId.endsWith('N') && !stopId.endsWith('S')) {
        const { arclength, distance } = projectPointToTrack(data.lat, data.lon, coords, cumDists);
        if (distance < 500) { // Within 500m of track
          rStops.push({ stopId, name: data.name, lat: data.lat, lon: data.lon, arclength, distance });
        }
      }
    }

    // Sort by arclength
    rStops.sort((a, b) => a.arclength - b.arclength);

    for (const stop of rStops) {
      console.log(`${stop.stopId},${stop.name},${stop.lat},${stop.lon},${stop.arclength.toFixed(0)},${stop.distance.toFixed(0)}`);
    }

    // Show distances between consecutive stops
    console.log('\n=== DISTANCES BETWEEN CONSECUTIVE R STOPS ===');
    console.log('from_stop,to_stop,distance_m');
    for (let i = 0; i < rStops.length - 1; i++) {
      const dist = rStops[i + 1].arclength - rStops[i].arclength;
      console.log(`${rStops[i].stopId},${rStops[i + 1].stopId},${dist.toFixed(0)}`);
    }

    expect(rStops.length).toBeGreaterThan(0);
  });

  it('computes real arclengths for 1 train stops', () => {
    const stopsText = fs.readFileSync(stopsPath, 'utf-8');
    const stops = parseStops(stopsText);

    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    // Find 1 route
    const oneFeature = geojson.features.find((f: { properties?: { route_id?: string } }) => f.properties?.route_id === '1');
    if (!oneFeature) {
      console.log('1 route not found in GeoJSON');
      return;
    }

    // Get longest segment
    let coords: [number, number][] = [];
    for (const segment of oneFeature.geometry.coordinates) {
      if (segment.length > coords.length) {
        coords = segment;
      }
    }

    const cumDists = computeCumulativeDistances(coords);
    const totalLength = cumDists[cumDists.length - 1];

    console.log('\n=== REAL 1 TRAIN STOP ARCLENGTHS ===');
    console.log(`1 route total length: ${totalLength.toFixed(0)} meters`);
    console.log('\nstop_id,name,lat,lon,arclength_m,dist_to_track_m');

    // Find 1 train stops (start with 1 in stop_id)
    const oneStops: Array<{ stopId: string; name: string; lat: number; lon: number; arclength: number; distance: number }> = [];

    for (const [stopId, data] of stops) {
      if (stopId.match(/^1\d{2}$/) && !stopId.endsWith('N') && !stopId.endsWith('S')) {
        const { arclength, distance } = projectPointToTrack(data.lat, data.lon, coords, cumDists);
        if (distance < 500) {
          oneStops.push({ stopId, name: data.name, lat: data.lat, lon: data.lon, arclength, distance });
        }
      }
    }

    // Sort by arclength
    oneStops.sort((a, b) => a.arclength - b.arclength);

    for (const stop of oneStops) {
      console.log(`${stop.stopId},${stop.name},${stop.lat},${stop.lon},${stop.arclength.toFixed(0)},${stop.distance.toFixed(0)}`);
    }

    // Show distances between consecutive stops
    console.log('\n=== DISTANCES BETWEEN CONSECUTIVE 1 STOPS ===');
    console.log('from_stop,to_stop,distance_m');
    for (let i = 0; i < oneStops.length - 1; i++) {
      const dist = oneStops[i + 1].arclength - oneStops[i].arclength;
      console.log(`${oneStops[i].stopId},${oneStops[i + 1].stopId},${dist.toFixed(0)}`);
    }

    expect(oneStops.length).toBeGreaterThan(0);
  });

  it('STATE MACHINE TEST with REAL R train data', () => {
    const stopsText = fs.readFileSync(stopsPath, 'utf-8');
    const stops = parseStops(stopsText);

    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    // Find R route
    const rFeature = geojson.features.find((f: { properties?: { route_id?: string } }) => f.properties?.route_id === 'R');
    if (!rFeature) {
      console.log('R route not found');
      return;
    }

    // Get coords
    let coords: [number, number][] = [];
    for (const segment of rFeature.geometry.coordinates) {
      if (segment.length > coords.length) coords = segment;
    }
    const cumDists = computeCumulativeDistances(coords);

    // Get real R stops with arclengths
    const rStops: Array<{ stopId: string; name: string; arclength: number }> = [];
    for (const [stopId, data] of stops) {
      if (stopId.startsWith('R') && !stopId.endsWith('N') && !stopId.endsWith('S')) {
        const { arclength, distance } = projectPointToTrack(data.lat, data.lon, coords, cumDists);
        if (distance < 500) {
          rStops.push({ stopId, name: data.name, arclength });
        }
      }
    }
    rStops.sort((a, b) => a.arclength - b.arclength);

    console.log('\n========================================');
    console.log('STATE MACHINE TEST WITH REAL R TRAIN DATA');
    console.log('========================================\n');

    // Use first 2 real stops
    const stop1 = rStops[0];
    const stop2 = rStops[1];
    const segmentLength = stop2.arclength - stop1.arclength;

    console.log(`Segment: ${stop1.name} → ${stop2.name}`);
    console.log(`Stop 1 (${stop1.stopId}): arclength = ${stop1.arclength.toFixed(0)}m`);
    console.log(`Stop 2 (${stop2.stopId}): arclength = ${stop2.arclength.toFixed(0)}m`);
    console.log(`Segment length: ${segmentLength.toFixed(0)}m`);
    console.log(`\nARRIVING threshold: 200m from station`);
    console.log(`BOARDING threshold: 20m from station (snap)`);

    console.log('\n--- CSV OUTPUT: STATE MACHINE TICK PROGRESSION ---');
    console.log('elapsed_sec,currentS,distanceToStation,progress,phase');

    const startMs = Date.now();
    const scheduledDuration = 90; // 90 seconds between stops

    let state = createTrainAnimationState(
      'test-trip', 'R',
      stop1.stopId, stop2.stopId,
      stop1.arclength, stop2.arclength,
      startMs, 0, scheduledDuration, 1.0
    );

    // Tick every 5 seconds for 100 seconds
    for (let elapsed = 0; elapsed <= 100; elapsed += 5) {
      const nowMs = startMs + elapsed * 1000;
      state = trainAnimationReducer(state, { type: 'TICK', nowMs });

      const distanceToStation = Math.abs(state.nextS - state.currentS);
      console.log(`${elapsed},${state.currentS.toFixed(0)},${distanceToStation.toFixed(0)},${state.progress.toFixed(3)},${state.phase}`);
    }

    console.log('\n--- PHASE TRANSITION ANALYSIS ---');
    console.log(`At progress=0.75: distance = ${(segmentLength * 0.25).toFixed(0)}m - should be ${segmentLength * 0.25 <= 200 ? 'ARRIVING' : 'APPROACHING'}`);
    console.log(`At progress=0.95: distance = ${(segmentLength * 0.05).toFixed(0)}m - should be ${segmentLength * 0.05 <= 20 ? 'BOARDING' : 'ARRIVING'}`);

    expect(state.phase).toBe('BOARDING');
  });

  it('STATE MACHINE: Full journey through 4 REAL R train stops', () => {
    const stopsText = fs.readFileSync(stopsPath, 'utf-8');
    const stops = parseStops(stopsText);

    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    const rFeature = geojson.features.find((f: { properties?: { route_id?: string } }) => f.properties?.route_id === 'R');
    if (!rFeature) return;

    let coords: [number, number][] = [];
    for (const segment of rFeature.geometry.coordinates) {
      if (segment.length > coords.length) coords = segment;
    }
    const cumDists = computeCumulativeDistances(coords);

    const rStops: Array<{ stopId: string; name: string; arclength: number }> = [];
    for (const [stopId, data] of stops) {
      if (stopId.startsWith('R') && !stopId.endsWith('N') && !stopId.endsWith('S')) {
        const { arclength, distance } = projectPointToTrack(data.lat, data.lon, coords, cumDists);
        if (distance < 500) {
          rStops.push({ stopId, name: data.name, arclength });
        }
      }
    }
    rStops.sort((a, b) => a.arclength - b.arclength);

    console.log('\n========================================');
    console.log('FULL JOURNEY: 4 REAL R TRAIN STOPS');
    console.log('========================================\n');

    // Use stops 0-4
    const journeyStops = rStops.slice(0, 5);
    console.log('Journey stops:');
    journeyStops.forEach((s, i) => console.log(`  ${i}: ${s.stopId} - ${s.name} (${s.arclength.toFixed(0)}m)`));

    console.log('\n--- CSV: FULL JOURNEY ---');
    console.log('time_sec,segment,stopId,currentS,distanceToStation,progress,phase');

    const startMs = Date.now();
    let state = createTrainAnimationState(
      'journey-trip', 'R',
      journeyStops[0].stopId, journeyStops[1].stopId,
      journeyStops[0].arclength, journeyStops[1].arclength,
      startMs, 0, 90, 1.0
    );

    let currentSegment = 0;
    let totalTime = 0;

    while (currentSegment < 4 && totalTime < 500) {
      const nowMs = startMs + totalTime * 1000;
      state = trainAnimationReducer(state, { type: 'TICK', nowMs });

      const distanceToStation = Math.abs(state.nextS - state.currentS);
      console.log(`${totalTime},${currentSegment},${state.nextStopId},${state.currentS.toFixed(0)},${distanceToStation.toFixed(0)},${state.progress.toFixed(3)},${state.phase}`);

      if (state.phase === 'BOARDING' && currentSegment < 3) {
        totalTime += 3; // dwell
        const nextNowMs = startMs + totalTime * 1000;

        // API update with next segment
        state = trainAnimationReducer(state, {
          type: 'API_UPDATE',
          nowMs: nextNowMs,
          prevStopId: journeyStops[currentSegment + 1].stopId,
          nextStopId: journeyStops[currentSegment + 2].stopId,
          prevS: journeyStops[currentSegment + 1].arclength,
          nextS: journeyStops[currentSegment + 2].arclength,
          apiProgress: 0,
        });

        state = trainAnimationReducer(state, { type: 'TICK', nowMs: nextNowMs });
        currentSegment++;

        const dist2 = Math.abs(state.nextS - state.currentS);
        console.log(`${totalTime},${currentSegment},${state.nextStopId},${state.currentS.toFixed(0)},${dist2.toFixed(0)},${state.progress.toFixed(3)},${state.phase}`);
      }

      totalTime += 5;
    }

    expect(currentSegment).toBeGreaterThan(0);
  });
});
