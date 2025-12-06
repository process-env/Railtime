# Train Animation State Machine - Review Context

**Last Updated: 2025-12-06**

## What Was Reviewed

### Primary Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/map/train-state-machine.ts` | 376 | Core state machine reducer |
| `src/lib/map/train-state-machine.test.ts` | 153 | Unit tests (mock data) |
| `src/lib/map/real-data.test.ts` | 416 | Integration tests (real GTFS) |
| `src/components/map/hooks/useMapAnimation.ts` | 288 | Animation loop hook |
| `src/components/map/hooks/useTrainMarkers.ts` | 678 | Marker management hook |

### Supporting Files
| File | Purpose |
|------|---------|
| `src/lib/map/track-index.ts` | Track geometry and stop arclength mapping |
| `src/lib/map/route-durations.ts` | GTFS-based segment duration matrix |
| `src/lib/map/arclength.ts` | Arclength ↔ lat/lon conversion |
| `public/data/stops.txt` | Real MTA stop data |
| `public/map/nyc-subway-lines.geojson` | Real subway track geometry |

---

## Architectural Context

### Data Flow
```
GTFS-realtime API
       ↓
TrainPosition (lat/lon, stopIds, times)
       ↓
useTrainMarkers (converts to arclength)
       ↓
TrainAnimationState (state machine)
       ↓
useMapAnimation (animation loop)
       ↓
MapLibre marker.setLngLat()
```

### State Machine Phases
```
APPROACHING ──(200m)──→ ARRIVING ──(20m)──→ BOARDING
     ↑                                          │
     └──────────(API_UPDATE with new segment)───┘
```

### Key Thresholds
- **ARRIVING_DISTANCE**: 200 meters - show "Arriving" in popup
- **STATION_SNAP_DISTANCE**: 20 meters - snap train to exact station position
- **SYNC_SNAP_THRESHOLD**: 30% - hard snap if animation is way off from API
- **SYNC_ADJUST_THRESHOLD**: 10% - adjust speed to catch up

---

## Assumptions

1. **API polling interval**: 15 seconds (trains get new positions every 15s)
2. **Animation target**: 60fps using requestAnimationFrame
3. **Segment duration**: Falls back to 90 seconds if GTFS matrix lookup fails
4. **Dwell time**: 2 seconds at station (quick visual feedback)
5. **Track geometry**: Uses longest segment of MultiLineString as main track

---

## Known Constraints

1. **Browser-only**: Uses dynamic imports to avoid SSR issues with maplibre-gl
2. **Single track per route**: Ignores branch lines (takes longest segment only)
3. **Unidirectional arclength**: Doesn't handle trains going backwards well
4. **No express detection**: Can't distinguish local vs express segments

---

## Trade-offs Made

### Distance vs Progress Thresholds
**Chosen:** Distance-based (200m, 20m)
**Alternative:** Progress-based (0.75, 0.95)
**Rationale:** Distance is consistent regardless of segment length. A 5km express segment shouldn't show "Arriving" at 1.25km away.

### State Machine vs Direct Animation
**Chosen:** Reducer pattern with explicit phases
**Alternative:** Simple lerp between API positions
**Rationale:** State machine makes timing predictable and testable. Easier to debug phase transitions.

### Dual Animation Systems
**Current state:** Both legacy and new systems coexist
**Reason:** Fallback for routes without track data
**Debt:** Should be consolidated once all routes work

---

## Related Tickets / Issues

- Train animations "zig-zag" and never reach stations
- ETA display shows static "1 min"
- State machine had undefined constants (STATION_THRESHOLD, ARRIVAL_THRESHOLD) - FIXED
- Tests used mock data instead of real GTFS - FIXED

---

## References

### MTA GTFS Data
- stops.txt: Station IDs, names, coordinates
- stop_times.txt: Arrival/departure times per trip
- trips.txt: Trip to route mapping

### Previous Decisions
- Changed from progress-based to distance-based phase detection
- Reduced dwell time from 30s to 2s
- Added pendingSegment caching for smooth transitions

---

## Files NOT Reviewed

- `src/lib/map/alpha-beta-gamma.ts` - Filter implementation (not actively used)
- `src/lib/map/motion-planner.ts` - Motion planning (deprecated)
- `src/lib/map/alert-speed.ts` - Alert-based speed modulation
- Server-side train position calculation
