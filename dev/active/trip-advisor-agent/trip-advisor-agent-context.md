# Trip Advisor Agent - Development Context

**Last Updated**: 2025-12-09T15:30:00Z
**Status**: PLANNING COMPLETE - Ready for Implementation
**Priority**: High

## Overview

Building a Trip Advisor Agent for the NYC Subway tracker that calculates optimal routes between stations using Dijkstra's algorithm, incorporating transfer station data and estimated travel times from GTFS data.

## Key Decisions Made This Session

### Design Decisions (User Confirmed)
1. **UI Location**: Sidebar panel (collapsible, accessible from any page)
2. **Real-time Integration**: Yes - adjust travel times based on service alerts
3. **Transfer Data**: Comprehensive - all 30+ transfer complexes with walk times

### Architectural Decisions
1. **Graph Model**: Nodes = (stationId, routeId) pairs, Edges = ride segments + transfers
2. **Algorithm**: Dijkstra with transfer penalty (5 min per transfer to discourage excessive transfers)
3. **Data Generation**: Build scripts parse GTFS → generate static JSON at build time
4. **State Management**: Zustand store (following existing ui-store pattern)
5. **API Design**: GET /api/v1/trip?origin=X&destination=Y&alternatives=3

## Research Completed

### Transfer Station Data Extracted
- 30+ inter-division transfer complexes identified from Wikipedia/Metro Wiki
- Walk times estimated: 120s (same level), 180s (different level), 240s (large complex), 300s (out-of-system)
- Station IDs need validation against stops.txt during implementation

### Existing Data Analysis
| File | Content | Size |
|------|---------|------|
| stops.txt | 243 parent stations, 1,497 total | 63 KB |
| routes.txt | 31 transit routes | 12 KB |
| stop_times.txt | 562,335 stop-time entries | 35 MB |
| duration-matrix.json | Pre-computed segment times | 6.1 MB |
| stations-enriched.json | Cross-street enrichment | 61 KB |

### Existing Code to Reuse
- `src/lib/mta/station-utils.ts` - getParentStationId(), isParentStation()
- `src/lib/map/route-durations.ts` - Duration loading pattern
- `scripts/build-duration-matrix.ts` - GTFS parsing pattern
- `src/stores/ui-store.ts` - Zustand store pattern

## Files to Create

### Phase 1: Data Layer
- `scripts/build-transfer-graph.ts` - Hardcoded transfer data → JSON
- `scripts/build-route-segments.ts` - Parse GTFS stop_times → ordered stops per route
- `public/data/transfer-graph.json` (generated)
- `public/data/route-segments.json` (generated)

### Phase 2: Algorithm Layer
- `src/lib/trip-planner/types.ts`
- `src/lib/trip-planner/graph-builder.ts`
- `src/lib/trip-planner/dijkstra.ts`
- `src/lib/trip-planner/path-converter.ts`
- `src/lib/trip-planner/index.ts`

### Phase 3: API Layer
- `src/app/api/v1/trip/route.ts`
- `src/lib/api/index.ts` (extend with planTrip method)

### Phase 4: UI Layer
- `src/types/trip.ts`
- `src/stores/trip-store.ts`
- `src/hooks/use-trip-planner.ts`
- `src/components/trip-planner/StationSearch.tsx`
- `src/components/trip-planner/TripResults.tsx`
- `src/components/trip-planner/TripDetails.tsx`
- `src/components/trip-planner/TripPlannerPanel.tsx`

## Implementation State

**Current Position**: About to start Phase 1 (build-transfer-graph.ts)

No code has been written yet - plan was just approved when context limit was reached.

## Complete Plan File Location

Full detailed plan with all transfer station data:
`C:\Users\User\.claude\plans\foamy-drifting-bonbon.md`

## Next Immediate Steps

1. Create `scripts/build-transfer-graph.ts` with hardcoded transfer data
2. Validate station IDs against stops.txt
3. Generate transfer-graph.json
4. Create `scripts/build-route-segments.ts` to parse stop_times.txt
5. Generate route-segments.json

## Transfer Data Reference (Key Complexes)

```
Times Square: 127, 902, 725, R16 → 1,2,3,7,N,Q,R,W,S,A,C,E (240s walk)
Union Square: 635, L01, R20 → 4,5,6,L,N,Q,R,W (180s walk)
Atlantic Ave: 235, D24, R31 → 2,3,4,5,B,D,N,Q,R (180s walk)
Herald Square: D17, R17 → B,D,F,M,N,Q,R,W (180s walk)
Fulton St: A38, 229, J25, M22 → A,C,J,Z,2,3,4,5 (180s walk)
```

## Commands to Run After Restart

```bash
# After implementing scripts:
npx ts-node scripts/build-transfer-graph.ts
npx ts-node scripts/build-route-segments.ts

# After implementing API:
npm run dev
# Test: curl "http://localhost:3000/api/v1/trip?origin=127&destination=635"
```

## Blockers/Issues

None discovered yet - plan is ready for implementation.
