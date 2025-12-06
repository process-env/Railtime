const fs = require('fs');
const path = require('path');

// Route colors
const ROUTE_COLORS = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C', '6X': '#00933C',
  '7': '#B933AD', '7X': '#B933AD',
  'A': '#2850AD', 'C': '#2850AD', 'E': '#2850AD',
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'FX': '#FF6319', 'M': '#FF6319',
  'G': '#6CBE45',
  'J': '#996633', 'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
  'S': '#808183', 'FS': '#808183', 'GS': '#808183', 'H': '#808183',
  'SI': '#0039A6', 'SIR': '#0039A6'
};

const rootDir = path.join(__dirname, '..');

// Read shapes.txt
const data = fs.readFileSync(path.join(rootDir, 'shapes.txt'), 'utf8');
const lines = data.trim().split('\n').slice(1); // Skip header

// Group by shape_id
const shapes = {};
for (const line of lines) {
  const [shape_id, seq, lat, lon] = line.split(',');
  if (!shapes[shape_id]) shapes[shape_id] = [];
  shapes[shape_id].push({ seq: parseInt(seq), lat: parseFloat(lat), lon: parseFloat(lon) });
}

// Get route from shape_id (e.g., "1..N03R" -> "1")
function getRouteId(shapeId) {
  const match = shapeId.match(/^([A-Z0-9]+)\.\./i);
  return match ? match[1].toUpperCase() : shapeId.split('.')[0].toUpperCase();
}

// Convert to GeoJSON - one line per route (merged shapes)
const routeCoords = {};
for (const [shapeId, points] of Object.entries(shapes)) {
  const routeId = getRouteId(shapeId);
  points.sort((a, b) => a.seq - b.seq);
  const coords = points.map(p => [p.lon, p.lat]);
  if (!routeCoords[routeId]) routeCoords[routeId] = [];
  routeCoords[routeId].push(coords);
}

// Build features
const features = [];
for (const [routeId, coordArrays] of Object.entries(routeCoords)) {
  const color = ROUTE_COLORS[routeId] || '#888888';
  features.push({
    type: 'Feature',
    properties: {
      route_id: routeId,
      color: color,
      name: `${routeId} Train`
    },
    geometry: {
      type: 'MultiLineString',
      coordinates: coordArrays
    }
  });
}

const geojson = {
  type: 'FeatureCollection',
  features: features
};

const outputPath = path.join(rootDir, 'public', 'map', 'nyc-subway-lines.geojson');
fs.writeFileSync(outputPath, JSON.stringify(geojson));
console.log(`Created GeoJSON with ${features.length} route features at ${outputPath}`);
