# Train Metadata Feature - Review Context

**Last Updated:** 2025-12-01

## What Was Reviewed

### Files Reviewed
| File Path | Lines | Purpose |
|-----------|-------|---------|
| `src/components/map/SubwayMap.tsx` | 537 | Main map component with train markers and animation |
| `src/components/map/TrainDetailPanel.tsx` | 139 | Train detail sidebar panel |
| `src/app/(dashboard)/stations/[stationId]/page.tsx` | 196 | Station detail page with arrivals |
| `src/components/stations/ArrivalBoard.tsx` | 111 | Arrival board display component |
| `src/lib/mta/arrivals.ts` | 204 | Arrivals data fetching and processing |
| `src/stores/ui-store.ts` | 77 | UI state management (Zustand) |
| `src/hooks/use-train-positions.ts` | 188 | Train position calculation hook |

### Feature Scope
This review covers the "Train Metadata Display" feature which includes:

1. **Map Train Detail Panel** - Click on train markers to see detailed information in a slide-in sidebar
2. **Station Arrivals Fix** - Fixed perpetual skeleton loading on station detail pages
3. **Train Animation** - Linear interpolation for smooth train movement with dwelling detection

### Branch/PR Information
- Branch: `main` (uncommitted changes)
- No PR created yet
- All changes are untracked/modified files

---

## Architectural Context

### Tech Stack
- **Framework:** Next.js 15 (App Router)
- **State:** Zustand with persist middleware
- **Maps:** MapLibre GL JS
- **UI:** shadcn/ui + Tailwind CSS
- **Data:** MTA GTFS-RT feeds via custom API routes

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  MTA GTFS-RT    │────▶│  /api/v1/feed/  │────▶│  useTrainPos    │
│  Feeds (8)      │     │  Route Handler  │     │  Hook           │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌─────────────────┐              │
                        │  trainsStore    │◀─────────────┘
                        │  (Zustand)      │
                        └────────┬────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  SubwayMap      │     │  TrainDetail    │     │  Station Detail │
│  Component      │     │  Panel          │     │  Page           │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Key Patterns

1. **Train Position Calculation** - Client-side interpolation between stops based on schedule times
2. **Animation Loop** - `requestAnimationFrame` for smooth 60fps updates
3. **Marker Management** - Refs to MapLibre markers, manually synced with React state
4. **Feed Group Strategy** - 8 separate MTA feeds queried in parallel

---

## Assumptions

1. **stops.txt data** - Does not contain route information (verified)
2. **Feed availability** - All 8 MTA feeds are always accessible
3. **Stop ID format** - Parent IDs are numeric, child IDs have N/S suffix
4. **Browser support** - Modern browsers with `requestAnimationFrame` support
5. **Network conditions** - Users have stable internet for 15s polling

---

## Known Constraints & Trade-offs

### Trade-off: Query All Feeds vs Route Mapping
**Decision:** Query all 8 feed groups for station arrivals
**Rationale:** `stops.txt` lacks route data, would require additional data source
**Impact:** 16 API calls per station page (8 feeds × 2 child stops)
**Future:** Could be optimized with route-stop mapping file

### Trade-off: Client-side Position Calculation
**Decision:** Calculate train positions in browser from schedule data
**Rationale:** MTA does not provide real-time GPS positions
**Impact:** Positions are estimates based on schedule, not actual location
**Future:** Could enhance with vehicle position data if available

### Trade-off: Large Component vs Multiple Small Components
**Decision:** SubwayMap is a single 537-line component
**Rationale:** Tight coupling between map, markers, and animation
**Impact:** Hard to test and maintain
**Future:** Should be refactored into smaller components

### Constraint: MapLibre Popup Styling
**Decision:** Inline styles in `setHTML()` calls
**Rationale:** MapLibre popups use raw HTML, not React
**Impact:** Styles not consistent with Tailwind/shadcn
**Future:** Could use CSS classes or create shadow DOM

---

## Related Tickets / Specs

- No formal tickets - feature developed from user feedback
- User reported: "skeleton animation" on station pages (fixed)
- User requested: "train metadata north and south arrival time" (implemented)

---

## Reference Conversations

### Problem Discovery (Station Arrivals)
1. User showed screenshot of station page showing endless skeleton loaders
2. Investigation found `routes: null` in stops.txt data
3. Root cause: `fetchArrivals` bailed early when `routes.length === 0`
4. Fix: Query all feed groups instead of filtering by routes

### Animation Discussion
1. User requested "constant linear motion unless train is stopped"
2. Changed from 2s eased animation to 15s linear interpolation
3. Added dwelling detection (threshold ~11m) to prevent jerky animation

---

## External Dependencies

### MTA GTFS-RT Feeds
- ACE, BDFM, G, JZ, NQRW, L, SI, 1234567
- Polled every 15 seconds
- No SLA guarantees from MTA

### MapLibre GL JS
- Version: Latest from npm
- Used for: Map rendering, markers, popups
- License: BSD-3-Clause

### CARTO Basemaps
- Style: Dark Matter
- URL: `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`
- Terms: Free tier, attribution required

---

## Files Not Reviewed

The following related files were not in scope but may be relevant:

- `src/lib/mta/fetch-feed.ts` - Feed fetching logic
- `src/lib/mta/parse-feed.ts` - GTFS-RT parsing
- `src/lib/mta/train-positions.ts` - Server-side position logic (if exists)
- `src/stores/trains-store.ts` - Trains state management
- API route handlers in `src/app/api/v1/`
