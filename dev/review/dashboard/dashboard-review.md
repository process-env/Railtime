# MTA Subway Tracker Dashboard - Code Review

**Last Updated:** 2025-12-01

---

## Executive Summary

The MTA Subway Tracker Dashboard is a well-structured Next.js 16 application that provides real-time NYC subway train tracking. The codebase demonstrates solid architectural decisions with proper separation of concerns using Zustand for state management, a clean API layer for GTFS-RT feed processing, and MapLibre GL for visualization.

**Overall Assessment:** **Needs Work** - The application has a solid foundation but has several critical issues that need addressing before production deployment:
1. Critical performance bug with hook dependency causing potential infinite loops (recently fixed)
2. Missing error boundaries and loading states
3. Duplicate code across modules
4. No test coverage
5. Security considerations for API key handling

**Risk Level:** Medium - The core functionality works, but stability and performance issues need resolution.

---

## Strengths

### 1. Architecture & Design
- **Clean separation of concerns**: API routes, hooks, stores, and components are well-organized
- **Type-safe**: Comprehensive TypeScript types in `src/types/mta.ts`
- **Zustand stores**: Well-designed state management with separate stores for trains, stations, and UI
- **Redis caching**: Graceful degradation when Redis is unavailable
- **Constants centralization**: Route colors, feed groups, and NYC bounds properly centralized

### 2. GTFS-RT Integration
- **Protobuf decoding**: Proper use of `protobufjs` for GTFS-RT feed parsing
- **Feed group organization**: Clear mapping between MTA feed endpoints and route groups
- **Arrival board calculation**: Solid logic for computing ETAs and humanized time strings

### 3. UI/UX
- **Dark theme by default**: Appropriate for transit data visualization
- **Route color coding**: Authentic MTA route colors
- **Responsive sidebar**: Proper mobile/desktop handling with Sheet component
- **MapLibre integration**: Smooth train position lerping animation

### 4. Code Quality
- **Consistent patterns**: Similar patterns across hooks (useTrainPositions, useArrivals, useAnalytics)
- **Error handling in API routes**: Proper try/catch with meaningful error messages
- **Modern React**: Uses React 19, Next.js 16, proper use of `use client` directives

---

## Issues & Findings

### Correctness / Bugs

#### CRITICAL: Hook Dependency Issue (Recently Fixed)
**Location:** `src/hooks/use-train-positions.ts:94-164`, `src/components/map/SubwayMap.tsx:40-44`

The `useTrainPositions` hook had a critical bug where `groupIds` array was recreated on every render, causing `fetchPositions` to be recreated, triggering infinite refetches. This was fixed by:
1. Moving `groupIds` and options to constants outside the component
2. Using `useRef` to store stable values in the hook

**Residual Risk:** Similar patterns exist in `useAnalytics` hook that may cause performance issues.

#### HIGH: Missing Error Boundary
**Location:** Entire application

No React Error Boundaries are implemented. If any component throws, the entire app crashes without graceful recovery.

```tsx
// Missing pattern like:
<ErrorBoundary fallback={<ErrorFallback />}>
  <SubwayMap />
</ErrorBoundary>
```

#### MEDIUM: ArrivalBoard Type Mismatch
**Location:** `src/components/stations/ArrivalBoard.tsx:8-15` vs `src/app/(dashboard)/stations/[stationId]/page.tsx:16-23`

The `Arrival` interface is defined locally in both files with slightly different structures. The page uses `arrivalTime: number` (Unix timestamp) while the API returns `whenISO: string` (ISO timestamp).

```tsx
// ArrivalBoard.tsx expects:
interface Arrival {
  arrivalTime: number;  // Unix timestamp
  eta: string;
}

// API returns (ArrivalItem type):
interface ArrivalItem {
  whenISO: string;  // ISO string
  in: string;       // Already computed ETA
}
```

#### MEDIUM: Potential Memory Leak in Animation Loop
**Location:** `src/components/map/SubwayMap.tsx:56-77`

The animation loop stores marker references in `trainAnimsRef` but markers might not be properly cleaned up when the component unmounts during active animations.

### Design & Architecture

#### HIGH: Duplicate Constants
**Location:**
- `src/lib/constants.ts` - `ROUTE_COLORS`, `FEED_GROUPS`
- `src/lib/mta/feed-groups.ts` - Same `ROUTE_COLORS`, `FEED_GROUPS`

The same constants are defined in two places, risking drift. Should consolidate to single source of truth.

#### MEDIUM: Inconsistent API Response Shapes
The arrivals API returns `ArrivalBoard` with `arrivals: ArrivalItem[]`, but the station detail page expects a different shape with `direction: 'N' | 'S'` which doesn't exist in `ArrivalItem`.

#### MEDIUM: Missing API Validation
**Location:** All API routes in `src/app/api/v1/`

No input validation using Zod despite having it as a dependency. Routes accept any `groupId` or `stopId` without validation.

```typescript
// Current (no validation):
const { groupId } = await params;

// Should be:
const schema = z.object({ groupId: z.enum(['ACE', 'BDFM', ...]) });
const { groupId } = schema.parse(await params);
```

### Maintainability & Readability

#### MEDIUM: Unused ROUTE_GROUPS Constant
**Location:** `src/components/layout/RouteFilter.tsx:8-20`

`ROUTE_GROUPS` is defined but never used. Dead code should be removed.

#### LOW: Inconsistent Import Paths
Some files use `@/lib/mta` barrel export while others import specific files. Should be consistent.

#### LOW: Magic Numbers
**Location:** Multiple files
- `15000` for refresh interval (should be `REFRESH_INTERVAL_MS`)
- `2000` for lerp duration (is named as `LERP_DURATION` - good)
- `472` hardcoded total stations count

### Performance & Scalability

#### HIGH: Analytics Hook Fetches All Feeds
**Location:** `src/hooks/use-analytics.ts:74-103`

The analytics hook fetches ALL 8 feed groups every 30 seconds just to get feed status. This is wasteful since the map already fetches these.

```typescript
// Fetches 8 API calls just for status
for (const group of FEED_GROUPS) {
  const response = await fetch(`/api/v1/feed/${group.id}`);
  // ...
}
```

Should either:
1. Use already-fetched data from trains store
2. Create a dedicated lightweight `/api/v1/feed-status` endpoint

#### MEDIUM: Station Markers Recreation
**Location:** `src/components/map/SubwayMap.tsx:185-279`

Station markers are checked and potentially updated on every render, even when only CSS properties change. Could be optimized with better diffing.

#### MEDIUM: No Request Deduplication
**Location:** `src/hooks/use-train-positions.ts`

If multiple components use `useTrainPositions`, they each trigger independent fetches. Should use SWR or React Query for automatic deduplication.

### Security & Privacy

#### MEDIUM: API Key in Client Bundle Risk
**Location:** `src/lib/mta/fetch-feed.ts:38`

The MTA API key is read from `process.env.MTA_API_KEY`. While this runs server-side, there's no explicit check preventing client-side calls.

#### LOW: No Rate Limiting
API routes have no rate limiting. Could be abused if publicly deployed.

### DX / API Ergonomics

#### MEDIUM: Inconsistent Hook Return Types
- `useTrainPositions` returns `{ trains: TrainPosition[] }`
- `useArrivals` returns `{ arrivals: ArrivalBoard | undefined }`
- `useAnalytics` returns `{ data: AnalyticsData | null }`

Should standardize on a consistent pattern.

---

## Recommendations

### Priority 1 (Critical)
1. **Add Error Boundaries** - Wrap major components with error boundaries
2. **Fix Type Mismatches** - Align `ArrivalBoard` component props with actual API response types
3. **Consolidate Constants** - Remove duplicate `ROUTE_COLORS` and `FEED_GROUPS`

### Priority 2 (High)
4. **Add API Validation** - Use Zod for all route parameters
5. **Optimize Analytics Hook** - Use existing store data instead of refetching
6. **Add Request Deduplication** - Consider SWR or React Query
7. **Clean Up Animation on Unmount** - Ensure all markers are properly disposed

### Priority 3 (Medium)
8. **Remove Dead Code** - `ROUTE_GROUPS` in RouteFilter.tsx
9. **Add Loading States** - Skeleton loaders for map, charts
10. **Create Feed Status Endpoint** - Lightweight endpoint for analytics
11. **Standardize Hook Returns** - Consistent shape across all data hooks

### Priority 4 (Low)
12. **Extract Magic Numbers** - Create named constants
13. **Add JSDoc Comments** - Document complex functions
14. **Consistent Import Paths** - Use barrel exports everywhere

---

## Testing & Coverage

### Current State
**No tests exist.** The project has no test files or testing dependencies in package.json.

### Recommended Test Coverage

#### Unit Tests (Priority 1)
- `src/lib/mta/parse-feed.ts` - Proto parsing and timestamp formatting
- `src/lib/mta/arrivals.ts` - `buildArrivalMap`, `humanEta`, `toLocalHHMM`
- `src/lib/constants.ts` - `getRouteColor` function
- Zustand stores - State mutations and selectors

#### Integration Tests (Priority 2)
- API routes - `/api/v1/feed/[groupId]`, `/api/v1/arrivals/[groupId]/[stopId]`
- Redis caching - Cache hit/miss behavior

#### Component Tests (Priority 3)
- `SubwayMap` - Marker creation/removal, animation state
- `ArrivalBoard` - Rendering arrivals, empty state, loading state
- `RouteFilter` - Toggle behavior, clear filters

#### E2E Tests (Priority 4)
- Full user flow: Load map → Filter routes → Select station → View arrivals

### Suggested Testing Stack
```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@testing-library/react": "^15.0.0",
    "@testing-library/user-event": "^14.0.0",
    "msw": "^2.0.0",
    "playwright": "^1.40.0"
  }
}
```

---

## Consistency with Standards

### Deviations from Best Practices

1. **No `next.config.js` shown** - Should verify proper configuration for API routes and environment variables

2. **Missing `.env.example`** - Required environment variables (`MTA_API_KEY`, `REDIS_URL`) should be documented

3. **No Suspense Boundaries** - React 19 supports Suspense for data fetching; not utilized

4. **Hardcoded Dark Theme** - `className="dark"` in root layout without theme toggle implementation

5. **No Metadata for Child Routes** - Only root layout has metadata; station pages should have dynamic metadata

### Positive Adherence
- Proper use of `'use client'` directives
- Next.js 16 App Router patterns
- TypeScript strict mode
- Tailwind CSS with proper utility usage
- Zustand persist middleware for UI state

---

## Overall Assessment

The MTA Subway Tracker Dashboard is a **capable MVP** with a solid architectural foundation. The GTFS-RT integration is well-implemented, the map visualization with smooth train lerping is impressive, and the Zustand state management is cleanly organized.

However, before production deployment, the following must be addressed:
1. Error handling and boundaries
2. Type consistency between API and components
3. Performance optimizations (especially analytics hook)
4. Basic test coverage
5. Input validation on API routes

**Recommendation:** Spend 2-3 focused development sessions addressing Priority 1 and 2 items before considering production deployment.
