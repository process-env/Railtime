# Map Components Review - Context

**Review Date:** 2025-12-06
**Reviewed By:** Claude Code Review

## Scope

This review covers the map visualization layer of the traintracker application, focusing on:

### Components
| File | Lines | Purpose |
|------|-------|---------|
| `SubwayMap.tsx` | 279 | Main map container, orchestrates hooks |
| `TrainDetailPanel.tsx` | 108 | Selected train details overlay |

### Hooks
| File | Lines | Purpose |
|------|-------|---------|
| `useMapAnimation.ts` | 424 | Animation loop, motion utilities |
| `useTrainMarkers.ts` | 794 | Train marker lifecycle, position updates |
| `useStationMarkers.ts` | 201 | Station marker management, selection |

### Data Hooks
| File | Lines | Purpose |
|------|-------|---------|
| `use-train-positions.ts` | ~50 | React Query wrapper for train API |
| `use-train-positions-suspense.ts` | 35 | Suspense-enabled variant |
| `use-prefetch-map.ts` | ~30 | Prefetch on hover |
| `use-background-sync.ts` | ~60 | Background data refresh |

### Stores
| File | Purpose |
|------|---------|
| `trains-store.ts` | Zustand store (possibly dead code) |
| `ui-store.ts` | UI state (selections, view settings) |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    SubwayMap.tsx                        │
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ useTrainPositions│  │ useStaticData (stations)   │  │
│  │ (React Query)   │  │ (React Query)              │  │
│  └────────┬────────┘  └──────────────┬─────────────┘  │
│           │                          │                 │
│           ▼                          ▼                 │
│  ┌─────────────────────────────────────────────────┐  │
│  │              useMapAnimation                     │  │
│  │  - requestAnimationFrame loop                   │  │
│  │  - trainAnimsRef (legacy lerp)                  │  │
│  │  - trainMotionRef (α-β-γ filter)                │  │
│  └─────────────────────────────────────────────────┘  │
│           │                          │                 │
│           ▼                          ▼                 │
│  ┌──────────────────┐    ┌─────────────────────────┐  │
│  │ useTrainMarkers  │    │ useStationMarkers       │  │
│  │  - Marker CRUD   │    │  - Station dots         │  │
│  │  - Popup HTML    │    │  - Selection state      │  │
│  │  - Phase detect  │    │  - Arrival indicators   │  │
│  └──────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Train Data Path
1. `mtaApi.getTrains()` fetches from `/api/trains`
2. React Query caches with 15s staleTime
3. `useTrainPositions` provides to SubwayMap
4. `useTrainMarkers` creates MapLibre markers
5. Animation loop updates positions via refs

### Animation Systems (Dual)

**Legacy System (trainAnimsRef)**
- Simple lerp interpolation
- Linear progress 0→1 between refreshes
- Used for basic position updates

**New System (trainMotionRef)**
- α-β-γ (alpha-beta-gamma) filter
- Predictive smoothing
- Phase detection (BOARDING, ARRIVING, APPROACHING)
- Schedule-based duration estimates

### Phase Detection Logic

```typescript
// Distance thresholds (from train-state-machine.ts)
STATION_SNAP_DISTANCE = 20    // meters → BOARDING
ARRIVING_DISTANCE = 200       // meters → ARRIVING
// Otherwise → APPROACHING
```

## Recent Changes (This Session)

### Performance Optimizations
- Phase polling reduced: 100ms → 500ms
- TERMINAL_STOPS moved to module level
- Element references cached in station markers
- Duration matrix load guard added

### Bug Fixes
- Route filter now immediately removes non-matching trains
- Station dots remain visible when filter active
- Detail panel phase syncs with popup via polling

### Caching Improvements
- gcTime extended to 30 minutes
- Background sync on non-map pages
- Prefetch on hover for map link

## Key Dependencies

- **maplibre-gl**: Map rendering
- **@tanstack/react-query**: Server state
- **zustand**: UI state
- **GTFS static data**: Route geometry, stop positions

## Known Technical Debt

1. **State machine disabled** - Boarding phase logic commented out
2. **Dual animation systems** - Both running, no deprecation plan
3. **No test coverage** - 1,800+ lines untested
4. **Magic numbers** - Hard-coded throughout

## Files NOT in Scope

- API routes (`/api/*`)
- Other pages (analytics, stations, alerts)
- Utility libraries (`/lib/*` except map-related)
- Global styles and theming
