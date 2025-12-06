# MTA Subway Tracker Dashboard - Review Context

**Last Updated:** 2025-12-01

---

## What Was Reviewed

### Scope
Full codebase review of the MTA Subway Tracker Dashboard Next.js application.

### Files Reviewed

#### Core Application
- `src/app/layout.tsx` - Root layout with dark theme
- `src/app/page.tsx` - Landing page (redirect)
- `src/app/(dashboard)/layout.tsx` - Dashboard layout with sidebar
- `src/app/(dashboard)/map/page.tsx` - Live map page
- `src/app/(dashboard)/analytics/page.tsx` - Analytics dashboard
- `src/app/(dashboard)/stations/page.tsx` - Station list
- `src/app/(dashboard)/stations/[stationId]/page.tsx` - Station detail

#### API Routes
- `src/app/api/v1/feed/route.ts` - All feeds endpoint
- `src/app/api/v1/feed/[groupId]/route.ts` - Single feed group
- `src/app/api/v1/arrivals/[groupId]/[stopId]/route.ts` - Arrivals for stop
- `src/app/api/v1/routes/route.ts` - Routes list
- `src/app/api/v1/stops/route.ts` - Stops list
- `src/app/api/health/route.ts` - Health check

#### Components
- `src/components/map/SubwayMap.tsx` - Main map with train markers
- `src/components/layout/Sidebar.tsx` - Navigation sidebar
- `src/components/layout/RouteFilter.tsx` - Route filter buttons
- `src/components/stations/ArrivalBoard.tsx` - Arrival display
- `src/components/stations/StationCard.tsx` - Station list item
- `src/components/analytics/*.tsx` - Chart components

#### State Management
- `src/stores/trains-store.ts` - Train positions and arrivals
- `src/stores/stations-store.ts` - Static station data
- `src/stores/ui-store.ts` - UI state with persistence

#### Hooks
- `src/hooks/use-train-positions.ts` - Real-time train fetching
- `src/hooks/use-arrivals.ts` - Arrivals data fetching
- `src/hooks/use-analytics.ts` - Analytics data aggregation

#### Library Code
- `src/lib/mta/fetch-feed.ts` - GTFS-RT feed fetching
- `src/lib/mta/parse-feed.ts` - Protobuf parsing
- `src/lib/mta/arrivals.ts` - Arrival board computation
- `src/lib/mta/feed-groups.ts` - Feed group configuration
- `src/lib/mta/load-stops.ts` - Station data loading
- `src/lib/redis.ts` - Redis caching utilities
- `src/lib/constants.ts` - Shared constants

#### Types
- `src/types/mta.ts` - All TypeScript interfaces

#### Configuration
- `package.json` - Dependencies and scripts
- `src/app/globals.css` - Global styles with theme variables

---

## Architectural Context

### Technology Stack
| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js | 16.0.6 |
| React | React | 19.2.0 |
| State Management | Zustand | 5.0.9 |
| Mapping | MapLibre GL | 5.13.0 |
| Charts | Recharts | 3.5.1 |
| Styling | Tailwind CSS | 4.x |
| Database | PostgreSQL/Prisma | 7.0.1 |
| Caching | Redis (ioredis) | 5.8.2 |
| GTFS Parsing | protobufjs | 7.5.4 |

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        MTA GTFS-RT API                       │
│  (8 feed endpoints: ACE, BDFM, G, JZ, NQRW, L, SI, 1234567) │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Next.js API Routes                      │
│  /api/v1/feed/[groupId] → fetchFeed() → parseFeedBuffer()   │
│  └── Redis Cache (15s TTL)                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Client-Side Hooks                        │
│  useTrainPositions() → calculatePositions() → trains[]      │
│  useArrivals() → ArrivalBoard data                          │
│  useAnalytics() → aggregated stats                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Zustand Stores                          │
│  trainsStore: { trains, arrivalsByStation, lastFeedUpdate } │
│  stationsStore: { stations, routes, parentStations }        │
│  uiStore: { theme, selectedStation, selectedRoutes, map }   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        UI Components                         │
│  SubwayMap ← train markers with lerping animation            │
│  ArrivalBoard ← upcoming train times                         │
│  RouteActivityChart ← bar chart of train counts             │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Client-Side Position Calculation**
   - Train positions are interpolated client-side from stop times
   - Reduces server load, enables smooth animations
   - Trade-off: Positions are estimates, not GPS-accurate

2. **Dual Caching Strategy**
   - Redis for API response caching (15-60s TTL)
   - Zustand for client state (persistent UI, ephemeral data)
   - Graceful degradation when Redis unavailable

3. **Feed Group Organization**
   - MTA provides 8 separate GTFS-RT feeds
   - App fetches all feeds in parallel
   - Each feed cached independently

4. **Dark Theme Default**
   - Hardcoded dark theme for transit data visualization
   - Theme toggle exists in store but not exposed in UI

---

## Assumptions

1. **MTA API Stability** - Assumes MTA feed URLs and format remain stable
2. **Redis Optional** - App works without Redis (slower, uncached)
3. **PostgreSQL Unused** - Prisma installed but no migrations/usage found
4. **Single Timezone** - Hardcoded to America/New_York
5. **Parent Station Convention** - Numeric IDs (e.g., "101") are parent stations

---

## Known Constraints

1. **No WebSocket Implementation** - Socket.io installed but not used
2. **Mock Data in Analytics** - Timeline data is random, not real
3. **No Authentication** - Public read-only dashboard
4. **Limited Mobile Optimization** - Map usable but not optimized for touch
5. **No Offline Support** - No service worker or caching strategy

---

## Trade-offs Made

| Decision | Benefit | Cost |
|----------|---------|------|
| Client-side lerping | Smooth animations | Higher client CPU |
| Fetch all feeds | Complete coverage | 8 API calls per refresh |
| In-memory stops cache | Fast lookups | ~2MB memory per instance |
| No DB for trains | Simpler architecture | No historical data |
| Hardcoded dark theme | Consistent UX | No user preference |

---

## Related Resources

### MTA Documentation
- [MTA Developer Portal](https://api.mta.info/)
- [GTFS-RT Specification](https://gtfs.org/realtime/)
- [NYC Subway GTFS Static](https://transitfeeds.com/p/mta/79)

### Project Dependencies
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Zustand](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [Recharts](https://recharts.org/en-US/)
- [shadcn/ui](https://ui.shadcn.com/) - UI components pattern

### Environment Variables Required
```env
# Required
MTA_API_KEY=your-mta-api-key

# Optional
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://...
```

---

## Review Methodology

1. **Static Analysis** - Read all source files for structure understanding
2. **Dependency Review** - Checked package.json for security/version issues
3. **Pattern Analysis** - Identified repeated patterns and anti-patterns
4. **Type Checking** - Verified TypeScript type consistency
5. **Performance Review** - Analyzed render cycles and data fetching
6. **Security Scan** - Checked for common vulnerabilities

### Not Covered
- Production deployment testing
- Load/stress testing
- Accessibility audit (a11y)
- Browser compatibility testing
- Mobile device testing
