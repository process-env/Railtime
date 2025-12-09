/**
 * Build Transfer Graph Script
 *
 * Generates a JSON file containing all NYC subway transfer connections
 * between stations in different complexes. This is used by the trip planner
 * to find optimal routes with transfers.
 *
 * Run with: npx ts-node scripts/build-transfer-graph.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'transfer-graph.json');

/**
 * Transfer complex definition
 * Each complex represents a station where passengers can transfer between lines
 */
interface TransferComplex {
  id: string;
  name: string;
  stationIds: string[];  // All station IDs in this complex
  routes: string[];      // All routes serving this complex
  walkTimeSeconds: number;
  type: 'in-system' | 'out-of-system';
}

/**
 * Transfer edge between two stations
 */
interface TransferEdge {
  fromStationId: string;
  toStationId: string;
  walkTimeSeconds: number;
  type: 'in-system' | 'out-of-system';
  complexId: string;
}

/**
 * Output format for the transfer graph
 */
interface TransferGraph {
  complexes: TransferComplex[];
  transfers: TransferEdge[];
  meta: {
    generatedAt: string;
    complexCount: number;
    transferCount: number;
  };
}

// NYC Subway Transfer Complexes
// Validated against public/data/stops.txt
const TRANSFER_COMPLEXES: TransferComplex[] = [
  // ============================================
  // ALL-DIVISION TRANSFERS (IRT/IND/BMT)
  // ============================================
  {
    id: 'times_sq_42',
    name: 'Times Square - 42nd Street',
    stationIds: ['127', '725', '902', 'R16', 'A27'],
    routes: ['1', '2', '3', '7', 'N', 'Q', 'R', 'W', 'S', 'A', 'C', 'E'],
    walkTimeSeconds: 240, // Large complex
    type: 'in-system'
  },
  {
    id: '14_st_6_av',
    name: '14th Street - Sixth Avenue',
    stationIds: ['132', 'F14', 'L03'],
    routes: ['1', '2', '3', 'F', 'M', 'L'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'fulton_st',
    name: 'Fulton Street',
    stationIds: ['229', 'A38', 'J27', 'M22'],
    routes: ['A', 'C', 'J', 'Z', '2', '3', '4', '5'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },

  // ============================================
  // IRT/IND TRANSFERS
  // ============================================
  {
    id: 'grand_central_42',
    name: 'Grand Central - 42nd Street',
    stationIds: ['631', '723', '901'],
    routes: ['4', '5', '6', '7', 'S'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'bryant_park_42',
    name: '42nd Street - Bryant Park / Fifth Avenue',
    stationIds: ['D16', '723'],
    routes: ['7', 'B', 'D', 'F', 'M'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'columbus_circle_59',
    name: '59th Street - Columbus Circle',
    stationIds: ['125', 'A24'],
    routes: ['1', 'A', 'B', 'C', 'D'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'lex_53',
    name: '51st/53rd Street - Lexington Avenue',
    stationIds: ['629', 'E01'],
    routes: ['6', 'E', 'M'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'jackson_hts_74',
    name: '74th Street - Roosevelt Avenue / Jackson Heights',
    stationIds: ['710', 'G14'],
    routes: ['7', 'E', 'F', 'M', 'R'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'yankee_161',
    name: '161st Street - Yankee Stadium',
    stationIds: ['414', 'D11'],
    routes: ['4', 'B', 'D'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: '168_st',
    name: '168th Street',
    stationIds: ['112', 'A09'],
    routes: ['1', 'A', 'C'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'court_sq',
    name: 'Court Square',
    stationIds: ['718', '719', 'F09', 'G22'],
    routes: ['7', 'E', 'M', 'G'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'wtc_park_pl',
    name: 'World Trade Center / Park Place',
    stationIds: ['E01', '229'],
    routes: ['E', '2', '3'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'bleecker_bway_lafayette',
    name: 'Bleecker Street / Broadway-Lafayette',
    stationIds: ['637', 'D21'],
    routes: ['6', 'B', 'D', 'F', 'M'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },

  // ============================================
  // IRT/BMT TRANSFERS
  // ============================================
  {
    id: 'union_sq_14',
    name: '14th Street - Union Square',
    stationIds: ['635', 'L01', 'R20'],
    routes: ['4', '5', '6', 'L', 'N', 'Q', 'R', 'W'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'atlantic_barclays',
    name: 'Atlantic Avenue - Barclays Center',
    stationIds: ['235', 'D24', 'R31'],
    routes: ['2', '3', '4', '5', 'B', 'D', 'N', 'Q', 'R'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'borough_hall',
    name: 'Borough Hall / Court Street',
    stationIds: ['232', '423', 'R28'],
    routes: ['2', '3', '4', '5', 'R'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'canal_st',
    name: 'Canal Street',
    stationIds: ['637', 'J21', 'R23', 'Q01'],
    routes: ['6', 'J', 'Z', 'N', 'Q', 'R', 'W'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'chambers_bklyn_bridge',
    name: 'Chambers Street / Brooklyn Bridge - City Hall',
    stationIds: ['640', 'M21'],
    routes: ['4', '5', '6', 'J', 'Z'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'queensboro_plaza',
    name: 'Queensboro Plaza',
    stationIds: ['718', 'R09'],
    routes: ['7', 'N', 'W'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'botanic_garden',
    name: 'Botanic Garden / Franklin Avenue',
    stationIds: ['239', 'S01'],
    routes: ['2', '3', '4', '5', 'S'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },

  // ============================================
  // IND/BMT TRANSFERS
  // ============================================
  {
    id: '4_av_9_st',
    name: 'Fourth Avenue - Ninth Street',
    stationIds: ['F20', 'R36'],
    routes: ['F', 'G', 'R'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: '14_st_8_av',
    name: '14th Street - Eighth Avenue',
    stationIds: ['A31', 'L02'],
    routes: ['A', 'C', 'E', 'L'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'herald_sq_34',
    name: '34th Street - Herald Square',
    stationIds: ['D17', 'R17'],
    routes: ['B', 'D', 'F', 'M', 'N', 'Q', 'R', 'W'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'broadway_junction',
    name: 'Broadway Junction',
    stationIds: ['A51', 'J27', 'L22'],
    routes: ['A', 'C', 'J', 'Z', 'L'],
    walkTimeSeconds: 180,
    type: 'in-system'
  },
  {
    id: 'essex_delancey',
    name: 'Delancey Street - Essex Street',
    stationIds: ['F15', 'M18'],
    routes: ['F', 'M', 'J', 'Z'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'lorimer_metropolitan',
    name: 'Lorimer Street / Metropolitan Avenue',
    stationIds: ['G29', 'L10'],
    routes: ['G', 'L'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'jamaica_center',
    name: 'Jamaica Center - Parsons/Archer',
    stationIds: ['G05'],  // G05 is shared by E, J, Z - same station
    routes: ['E', 'J', 'Z'],
    walkTimeSeconds: 60,  // Same platform transfers
    type: 'in-system'
  },
  {
    id: 'sutphin_blvd',
    name: 'Sutphin Boulevard - Archer Avenue - JFK',
    stationIds: ['G06'],  // G06 is shared by E, J, Z - same station
    routes: ['E', 'J', 'Z'],
    walkTimeSeconds: 60,  // Same platform transfers
    type: 'in-system'
  },
  {
    id: 'myrtle_wyckoff',
    name: 'Myrtle-Wyckoff Avenues',
    stationIds: ['L17', 'M11'],
    routes: ['L', 'M'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },
  {
    id: 'franklin_av_fulton',
    name: 'Franklin Avenue / Fulton Street',
    stationIds: ['A45', 'S01'],
    routes: ['A', 'C', 'S'],
    walkTimeSeconds: 120,
    type: 'in-system'
  },

  // ============================================
  // OUT-OF-SYSTEM TRANSFERS (MetroCard/OMNY Free)
  // ============================================
  {
    id: 'lex_59_63_oos',
    name: 'Lexington Avenue 59th/63rd Streets (Out-of-System)',
    stationIds: ['629', 'R11', 'F15'],
    routes: ['4', '5', '6', 'N', 'R', 'W', 'F', 'Q'],
    walkTimeSeconds: 300, // Above ground walk
    type: 'out-of-system'
  },
  {
    id: 'livonia_junius_oos',
    name: 'Livonia Avenue / Junius Street (Out-of-System)',
    stationIds: ['L27', '253'],
    routes: ['L', '3'],
    walkTimeSeconds: 300,
    type: 'out-of-system'
  }
];

/**
 * Load and validate station IDs against stops.txt
 */
function loadStops(): Map<string, string> {
  const stopsPath = path.join(DATA_DIR, 'stops.txt');
  const stopsText = fs.readFileSync(stopsPath, 'utf-8');
  const stops = new Map<string, string>();

  const lines = stopsText.split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    const stopId = parts[0]?.trim();
    const stopName = parts[1]?.trim();
    const locationType = parts[4]?.trim();

    // Only include parent stations (location_type = 1)
    if (stopId && stopName && locationType === '1') {
      stops.set(stopId, stopName);
    }
  }

  return stops;
}

/**
 * Generate all transfer edges between stations in a complex
 */
function generateTransferEdges(complex: TransferComplex): TransferEdge[] {
  const edges: TransferEdge[] = [];

  // Create bidirectional edges between all stations in the complex
  for (let i = 0; i < complex.stationIds.length; i++) {
    for (let j = i + 1; j < complex.stationIds.length; j++) {
      const stationA = complex.stationIds[i];
      const stationB = complex.stationIds[j];

      // Forward edge
      edges.push({
        fromStationId: stationA,
        toStationId: stationB,
        walkTimeSeconds: complex.walkTimeSeconds,
        type: complex.type,
        complexId: complex.id
      });

      // Reverse edge
      edges.push({
        fromStationId: stationB,
        toStationId: stationA,
        walkTimeSeconds: complex.walkTimeSeconds,
        type: complex.type,
        complexId: complex.id
      });
    }
  }

  return edges;
}

async function buildTransferGraph() {
  console.log('Building transfer graph...');
  const startTime = Date.now();

  // Load stops for validation
  const stops = loadStops();
  console.log(`  Loaded ${stops.size} parent stations from stops.txt`);

  // Validate station IDs
  let invalidCount = 0;
  const validComplexes: TransferComplex[] = [];

  for (const complex of TRANSFER_COMPLEXES) {
    const validStationIds: string[] = [];
    for (const stationId of complex.stationIds) {
      if (stops.has(stationId)) {
        validStationIds.push(stationId);
      } else {
        console.warn(`  Warning: Station ID ${stationId} not found in stops.txt (complex: ${complex.name})`);
        invalidCount++;
      }
    }

    if (validStationIds.length >= 2) {
      validComplexes.push({
        ...complex,
        stationIds: validStationIds
      });
    } else {
      console.warn(`  Warning: Complex ${complex.name} has fewer than 2 valid stations, skipping`);
    }
  }

  // Generate transfer edges
  const allEdges: TransferEdge[] = [];
  for (const complex of validComplexes) {
    const edges = generateTransferEdges(complex);
    allEdges.push(...edges);
  }

  // Build output
  const graph: TransferGraph = {
    complexes: validComplexes,
    transfers: allEdges,
    meta: {
      generatedAt: new Date().toISOString(),
      complexCount: validComplexes.length,
      transferCount: allEdges.length
    }
  };

  // Write output
  const output = JSON.stringify(graph, null, 2);
  fs.writeFileSync(OUTPUT_FILE, output);

  const elapsed = Date.now() - startTime;
  console.log(`\nDone in ${elapsed}ms`);
  console.log(`  Complexes: ${validComplexes.length}`);
  console.log(`  Transfer edges: ${allEdges.length}`);
  if (invalidCount > 0) {
    console.log(`  Invalid station IDs: ${invalidCount}`);
  }
  console.log(`  Output: ${(output.length / 1024).toFixed(1)} KB → ${OUTPUT_FILE}`);
}

buildTransferGraph().catch(console.error);
