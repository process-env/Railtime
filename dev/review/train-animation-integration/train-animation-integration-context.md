# Train Animation Integration - Context

**Last Updated: 2025-12-06**

## What Was Reviewed

### Files Analyzed
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/map/hooks/useMapAnimation.ts` | 288 | Animation loop with requestAnimationFrame |
| `src/components/map/hooks/useTrainMarkers.ts` | 678 | Marker creation, API data processing |
| `src/lib/map/train-state-machine.ts` | 376 | State machine reducer for animation |
| `src/lib/map/real-data.test.ts` | 416 | Integration tests with real GTFS |
| `src/lib/map/train-state-machine.test.ts` | 195 | Unit tests for state machine |

### Scope
- Focus on train animation zig-zag issue
- Integration between state machine and hooks
- Data flow from API to screen

---

## Architectural Context

### Data Flow (Intended)
```
1. API returns TrainPosition { lat, lon, prevStopId, nextStopId, timestamps }
           ↓
2. useTrainMarkers calls getStopArclength() to convert stop IDs to arclength
           ↓
3. Dispatches API_UPDATE to state machine
           ↓
4. State machine updates phase, currentS, progress
           ↓
5. Animation loop (useMapAnimation) dispatches TICK every frame
           ↓
6. State machine returns currentS
           ↓
7. arclengthToLatLon() converts to lat/lon
           ↓
8. marker.setLngLat() updates visual
```

### Data Flow (Actual - Problem)
```
1-3. Same as above
           ↓
4. State machine updates animState.currentS
           ↓
5. useTrainMarkers ALSO updates state.filter.s, state.prevS, state.nextS  <-- CONFLICT
           ↓
6. Animation loop reads from state machine
           ↓
7. But arclength bounds may be stale → position jumps → ZIG-ZAG
```

---

## Key Decisions Made

### 1. State Machine Pattern
**Decision**: Use reducer pattern with explicit phases
**Rationale**: Predictable, testable, debuggable

### 2. Distance-Based Thresholds
**Decision**: Use meters (200m ARRIVING, 20m BOARDING)
**Rationale**: Percentage-based would vary wildly with segment length

### 3. Pending Segment Caching
**Decision**: Cache API segment updates while dwelling
**Rationale**: Don't interrupt "stopped at station" visual

---

## Known Constraints

1. **API updates every ~15 seconds** - animation must interpolate between updates
2. **GTFS-realtime doesn't give exact position** - only prev/next stop + timestamps
3. **Track geometry is imperfect** - some stops don't project perfectly onto track
4. **SSR environment** - can't import MapLibre at module level

---

## Related Files Not Reviewed

- `src/lib/map/track-index.ts` - Track geometry, arclength computation
- `src/lib/map/route-durations.ts` - GTFS duration matrix
- `src/lib/map/arclength.ts` - Arclength ↔ lat/lon conversion
- `src/lib/map/alpha-beta-gamma.ts` - Legacy filter (deprecated)

---

## Previous Work

| Date | Action |
|------|--------|
| 2025-12-06 | Fixed undefined constants (STATION_THRESHOLD, ARRIVAL_THRESHOLD) |
| 2025-12-06 | Changed to distance-based phase detection |
| 2025-12-06 | Created real-data.test.ts with GTFS integration |
| 2025-12-06 | Fixed speed multiplier compounding bug (line 315) |
| 2025-12-06 | This review: identified dual-update conflict |

---

## References

- Previous review: `dev/review/train-animation-state-machine/`
- Task docs: `dev/active/train-animation-fix/`
- Handoff: `dev/HANDOFF.md`
