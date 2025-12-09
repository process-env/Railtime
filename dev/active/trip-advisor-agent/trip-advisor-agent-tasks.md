# Trip Advisor Agent - Task List

**Last Updated**: 2025-12-09T15:30:00Z

## Phase 1: Data Layer

- [ ] Create `scripts/build-transfer-graph.ts` with hardcoded transfer data
- [ ] Validate station IDs against stops.txt
- [ ] Create `scripts/build-route-segments.ts` to parse GTFS
- [ ] Generate `public/data/transfer-graph.json`
- [ ] Generate `public/data/route-segments.json`

## Phase 2: Algorithm Layer

- [ ] Create `src/lib/trip-planner/types.ts` (GraphNode, TripSegment, TripPlan)
- [ ] Implement `src/lib/trip-planner/graph-builder.ts`
- [ ] Implement `src/lib/trip-planner/dijkstra.ts` with priority queue
- [ ] Implement `src/lib/trip-planner/path-converter.ts`
- [ ] Create main export `src/lib/trip-planner/index.ts`
- [ ] Write unit tests for pathfinding

## Phase 3: API Layer

- [ ] Create `src/app/api/v1/trip/route.ts` endpoint
- [ ] Add planTrip method to `src/lib/api/index.ts`
- [ ] Add validation with Zod schema
- [ ] Test API endpoint

## Phase 4: UI Layer

- [ ] Create `src/types/trip.ts`
- [ ] Create `src/stores/trip-store.ts` (Zustand)
- [ ] Create `src/hooks/use-trip-planner.ts`
- [ ] Build `src/components/trip-planner/StationSearch.tsx`
- [ ] Build `src/components/trip-planner/TripResults.tsx`
- [ ] Build `src/components/trip-planner/TripDetails.tsx`
- [ ] Build `src/components/trip-planner/TripPlannerPanel.tsx`

## Phase 5: Integration

- [ ] Add TripPlannerPanel to AppSidebar
- [ ] Add real-time delay integration (optional enhancement)
- [ ] Add map visualization of selected route (optional)
- [ ] End-to-end testing
- [ ] Performance optimization

## Current Priority

**Start with**: `scripts/build-transfer-graph.ts`

The transfer graph is the foundation - without it, we can't build the pathfinding algorithm.
