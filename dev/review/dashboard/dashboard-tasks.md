# MTA Subway Tracker Dashboard - Review Tasks

**Last Updated:** 2025-12-01

---

## Task Legend
- **Severity:** Critical | High | Medium | Low
- **Effort:** S (< 1hr) | M (1-4hr) | L (4-8hr) | XL (> 8hr)
- **Category:** Bug | Refactor | Cleanup | Perf | Security | Tests | Docs

---

## Priority 1: Critical Issues

### Theme: Error Handling & Stability

- [ ] **Add React Error Boundaries**
  - Category: Bug
  - Severity: Critical
  - Effort: M
  - Files: `src/app/(dashboard)/layout.tsx`, create `src/components/ErrorBoundary.tsx`
  - Description: Create error boundary components to catch React errors gracefully. Wrap SubwayMap, analytics charts, and station detail page.
  - Acceptance Criteria:
    - [ ] ErrorBoundary component created with fallback UI
    - [ ] Map errors don't crash entire app
    - [ ] Chart errors show "Failed to load" message
    - [ ] "Retry" button available on error fallbacks
  - Dependencies: None
  - See: [dashboard-review.md#high-missing-error-boundary]

- [ ] **Fix ArrivalBoard Type Mismatch**
  - Category: Bug
  - Severity: Critical
  - Effort: S
  - Files: `src/components/stations/ArrivalBoard.tsx`, `src/app/(dashboard)/stations/[stationId]/page.tsx`
  - Description: The Arrival interface in ArrivalBoard expects `arrivalTime: number` but API returns `whenISO: string`. Align types to prevent runtime errors.
  - Acceptance Criteria:
    - [ ] ArrivalBoard uses ArrivalItem type from `@/types/mta`
    - [ ] Station detail page correctly transforms API response
    - [ ] No TypeScript errors
  - Dependencies: None
  - See: [dashboard-review.md#medium-arrivalboard-type-mismatch]

---

## Priority 2: High Priority Issues

### Theme: Code Quality & Deduplication

- [ ] **Consolidate Duplicate Constants**
  - Category: Refactor
  - Severity: High
  - Effort: S
  - Files: `src/lib/constants.ts`, `src/lib/mta/feed-groups.ts`
  - Description: Remove duplicate `ROUTE_COLORS` and `FEED_GROUPS` definitions. Keep single source of truth in `src/lib/constants.ts`.
  - Acceptance Criteria:
    - [ ] `ROUTE_COLORS` defined only in `constants.ts`
    - [ ] `FEED_GROUPS` defined only in one location
    - [ ] `feed-groups.ts` imports from constants
    - [ ] All existing imports still work
  - Dependencies: None
  - See: [dashboard-review.md#high-duplicate-constants]

- [ ] **Add API Input Validation**
  - Category: Security
  - Severity: High
  - Effort: M
  - Files: All routes in `src/app/api/v1/`
  - Description: Use Zod (already installed) to validate all route parameters. Reject invalid groupIds, stopIds, etc.
  - Acceptance Criteria:
    - [ ] Zod schemas for groupId (enum), stopId (string pattern)
    - [ ] Invalid groupId returns 400 with error message
    - [ ] Invalid stopId returns 400 with error message
    - [ ] Nocache query param validated as boolean
  - Dependencies: None
  - See: [dashboard-review.md#medium-missing-api-validation]

### Theme: Performance Optimization

- [ ] **Optimize Analytics Hook**
  - Category: Perf
  - Severity: High
  - Effort: M
  - Files: `src/hooks/use-analytics.ts`
  - Description: Currently fetches all 8 feeds just for status. Should use existing store data or create lightweight status endpoint.
  - Acceptance Criteria:
    - [ ] Analytics hook reads from trainsStore.lastFeedUpdate
    - [ ] No duplicate feed fetches
    - [ ] Feed status derives from store timestamps
    - [ ] Remove redundant API calls from hook
  - Dependencies: None
  - See: [dashboard-review.md#high-analytics-hook-fetches-all-feeds]

- [ ] **Clean Up Animation on Unmount**
  - Category: Bug
  - Severity: High
  - Effort: S
  - Files: `src/components/map/SubwayMap.tsx`
  - Description: Ensure animation loop and markers are properly cleaned up when component unmounts to prevent memory leaks.
  - Acceptance Criteria:
    - [ ] Animation frame cancelled on unmount
    - [ ] All markers removed from trainAnimsRef
    - [ ] No console warnings about updating unmounted component
  - Dependencies: None
  - See: [dashboard-review.md#medium-potential-memory-leak-in-animation-loop]

---

## Priority 3: Medium Priority Issues

### Theme: Code Cleanup

- [ ] **Remove Dead Code**
  - Category: Cleanup
  - Severity: Medium
  - Effort: S
  - Files: `src/components/layout/RouteFilter.tsx`
  - Description: Remove unused `ROUTE_GROUPS` constant.
  - Acceptance Criteria:
    - [ ] `ROUTE_GROUPS` removed from RouteFilter.tsx
    - [ ] No other references to removed code
  - Dependencies: None
  - See: [dashboard-review.md#medium-unused-route_groups-constant]

- [ ] **Standardize Hook Return Types**
  - Category: Refactor
  - Severity: Medium
  - Effort: M
  - Files: `src/hooks/*.ts`
  - Description: Create consistent return type pattern across all data hooks.
  - Acceptance Criteria:
    - [ ] All hooks return `{ data, isLoading, error, refetch }`
    - [ ] `data` is always the main payload (not wrapped in object)
    - [ ] Type for common hook result exported
  - Dependencies: None
  - See: [dashboard-review.md#medium-inconsistent-hook-return-types]

### Theme: Loading States

- [ ] **Add Loading Skeletons to Map Page**
  - Category: Bug
  - Severity: Medium
  - Effort: S
  - Files: `src/app/(dashboard)/map/page.tsx`, `src/components/map/SubwayMap.tsx`
  - Description: Show loading skeleton while map initializes and stations load.
  - Acceptance Criteria:
    - [ ] Skeleton shown while mapLoaded is false
    - [ ] "Loading stations..." indicator during initial fetch
    - [ ] Smooth transition to map when ready
  - Dependencies: None

- [ ] **Create Feed Status Endpoint**
  - Category: Perf
  - Severity: Medium
  - Effort: M
  - Files: Create `src/app/api/v1/feed-status/route.ts`
  - Description: Lightweight endpoint returning just feed timestamps and status, not full feed data.
  - Acceptance Criteria:
    - [ ] Returns `{ [groupId]: { lastUpdate, status } }`
    - [ ] Much smaller response than full feed
    - [ ] Analytics can use this instead of fetching all feeds
  - Dependencies: None

---

## Priority 4: Low Priority Issues

### Theme: Documentation & DX

- [ ] **Extract Magic Numbers to Constants**
  - Category: Cleanup
  - Severity: Low
  - Effort: S
  - Files: Multiple
  - Description: Replace hardcoded numbers with named constants.
  - Acceptance Criteria:
    - [ ] `REFRESH_INTERVAL_MS = 15000` for train positions
    - [ ] `ANALYTICS_REFRESH_MS = 30000` for analytics
    - [ ] `TOTAL_STATIONS = 472` (or fetch dynamically)
    - [ ] `ARRIVAL_WINDOW_MS = 20 * 60 * 1000` (20 minutes)
  - Dependencies: None
  - See: [dashboard-review.md#low-magic-numbers]

- [ ] **Add JSDoc Comments**
  - Category: Docs
  - Severity: Low
  - Effort: M
  - Files: `src/lib/mta/*.ts`, `src/hooks/*.ts`
  - Description: Add JSDoc comments to exported functions explaining params, returns, and behavior.
  - Acceptance Criteria:
    - [ ] All exported functions have JSDoc
    - [ ] Complex algorithms have inline comments
    - [ ] Types are self-documenting where possible
  - Dependencies: None

- [ ] **Create .env.example**
  - Category: Docs
  - Severity: Low
  - Effort: S
  - Files: Create `.env.example`
  - Description: Document required and optional environment variables.
  - Acceptance Criteria:
    - [ ] `.env.example` created with all vars
    - [ ] Comments explaining each variable
    - [ ] README mentions environment setup
  - Dependencies: None

---

## Testing Tasks

### Theme: Test Coverage

- [ ] **Set Up Testing Infrastructure**
  - Category: Tests
  - Severity: High
  - Effort: M
  - Files: `package.json`, create `vitest.config.ts`, `src/test/setup.ts`
  - Description: Add Vitest, Testing Library, and MSW for testing.
  - Acceptance Criteria:
    - [ ] `npm test` runs Vitest
    - [ ] Testing Library configured for React
    - [ ] MSW for API mocking
    - [ ] Test file patterns configured
  - Dependencies: None

- [ ] **Add Unit Tests for MTA Library**
  - Category: Tests
  - Severity: High
  - Effort: L
  - Files: Create `src/lib/mta/__tests__/*.test.ts`
  - Description: Unit tests for GTFS parsing, arrival calculation, time formatting.
  - Acceptance Criteria:
    - [ ] `parse-feed.ts` - formatTimestamp tests
    - [ ] `arrivals.ts` - humanEta, toLocalHHMM tests
    - [ ] `arrivals.ts` - buildArrivalMap with mock data
    - [ ] Constants functions tested
  - Dependencies: Set Up Testing Infrastructure

- [ ] **Add Store Tests**
  - Category: Tests
  - Severity: Medium
  - Effort: M
  - Files: Create `src/stores/__tests__/*.test.ts`
  - Description: Test Zustand store mutations and selectors.
  - Acceptance Criteria:
    - [ ] trainsStore.updateTrains adds/updates correctly
    - [ ] trainsStore.getTrainsByRoute filters correctly
    - [ ] stationsStore.searchStations returns matches
    - [ ] uiStore.toggleRouteFilter toggles correctly
  - Dependencies: Set Up Testing Infrastructure

- [ ] **Add API Route Integration Tests**
  - Category: Tests
  - Severity: Medium
  - Effort: L
  - Files: Create `src/app/api/__tests__/*.test.ts`
  - Description: Integration tests for API routes with mocked MTA responses.
  - Acceptance Criteria:
    - [ ] Feed route returns parsed entities
    - [ ] Arrivals route returns board for stop
    - [ ] Invalid groupId returns 400
    - [ ] Error cases handled gracefully
  - Dependencies: Set Up Testing Infrastructure

- [ ] **Add Component Tests**
  - Category: Tests
  - Severity: Medium
  - Effort: L
  - Files: Create `src/components/__tests__/*.test.tsx`
  - Description: Component tests with Testing Library.
  - Acceptance Criteria:
    - [ ] ArrivalBoard renders arrivals correctly
    - [ ] ArrivalBoard shows empty state
    - [ ] RouteFilter toggles routes
    - [ ] StationCard displays station info
  - Dependencies: Set Up Testing Infrastructure

---

## Summary

| Priority | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Bugs     | 2        | 1    | 1      | 0   | 4     |
| Refactor | 0        | 1    | 1      | 0   | 2     |
| Cleanup  | 0        | 0    | 1      | 1   | 2     |
| Perf     | 0        | 1    | 1      | 0   | 2     |
| Security | 0        | 1    | 0      | 0   | 1     |
| Tests    | 0        | 2    | 3      | 0   | 5     |
| Docs     | 0        | 0    | 0      | 2   | 2     |

**Total Tasks:** 18

**Estimated Total Effort:**
- Small (S): 7 tasks
- Medium (M): 8 tasks
- Large (L): 3 tasks
- Extra Large (XL): 0 tasks
