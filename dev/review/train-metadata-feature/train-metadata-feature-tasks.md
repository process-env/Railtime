# Train Metadata Feature - Task List

**Last Updated:** 2025-12-01

## Summary

| Priority | Count | Categories |
|----------|-------|------------|
| Critical | 0 | - |
| High | 2 | Refactor |
| Medium | 4 | Refactor, Perf, Cleanup |
| Low | 4 | Cleanup, Tests |

---

## High Priority

### Refactoring & Architecture

- [ ] **Extract shared utility functions**
  - **Severity:** High | **Effort:** S
  - **Files:** `SubwayMap.tsx`, `TrainDetailPanel.tsx`, `ArrivalBoard.tsx`
  - Create `src/lib/mta/format.ts` with shared functions:
    - `getDirectionFromStopId(stopId: string): 'N' | 'S' | null`
    - `formatEta(eta: string, format?: 'short' | 'long'): string`
    - `formatTime(eta: string): string`
  - Update imports in all consuming files
  - **See:** [Review - Issue #1, #10](#issue-1-duplicate-helper-functions-medium)

- [ ] **Break up SubwayMap component**
  - **Severity:** High | **Effort:** L
  - **Files:** `SubwayMap.tsx`
  - Extract into smaller components:
    - `src/components/map/MapContainer.tsx` - map init, lifecycle, controls
    - `src/components/map/StationMarkers.tsx` - station marker management
    - `src/components/map/TrainMarkers.tsx` - train markers with animation
    - `src/components/map/useMapAnimation.ts` - animation hook
  - Keep `SubwayMap.tsx` as composition of above
  - **See:** [Review - Issue #6](#issue-6-subwaymap-component-is-oversized-high)

---

## Medium Priority

### Performance

- [ ] **Optimize station arrivals API calls**
  - **Severity:** Medium | **Effort:** M
  - **Files:** `stations/[stationId]/page.tsx`, potentially new API route
  - Options:
    1. Create `/api/v1/arrivals/station/{stationId}` endpoint that queries relevant feeds
    2. Create route-to-feed-group mapping file
    3. Infer feed group from station ID prefix (less reliable)
  - Reduce from 16 calls to 2-4 calls per station
  - **See:** [Review - Issue #8](#issue-8-all-feed-groups-queried-for-every-station-medium)

- [ ] **Fix stale closure in click handler**
  - **Severity:** Medium | **Effort:** S
  - **Files:** `SubwayMap.tsx:463-464`
  - Current code captures `selectedTrainId` at marker creation time
  - Options:
    1. Access state via `useUIStore.getState()` in click handler
    2. Store selected state in marker element dataset
    3. Recreate markers when selection changes (performance cost)
  - **See:** [Review - Issue #2](#issue-2-event-listener-closure-over-stale-state-medium)

### Cleanup

- [ ] **Extract popup styles to CSS**
  - **Severity:** Medium | **Effort:** M
  - **Files:** `SubwayMap.tsx:368-392, 424-448`
  - Create `src/styles/map-popups.css` with classes
  - Or create template function that generates HTML with class names
  - Ensure MapLibre popup container has appropriate class
  - **See:** [Review - Issue #4](#issue-4-inline-styles-in-map-popups-medium)

- [ ] **Type API responses properly**
  - **Severity:** Medium | **Effort:** S
  - **Files:** `stations/[stationId]/page.tsx:54-57`
  - Add type assertions or create typed fetch wrapper:
    ```typescript
    const data = await response.json() as ArrivalBoard;
    ```
  - Consider using `zod` for runtime validation
  - **See:** [Review - Issue #5](#issue-5-missing-typescript-generic-for-api-responses-low)

---

## Low Priority

### Cleanup & Polish

- [ ] **Fix trip ID truncation display**
  - **Severity:** Low | **Effort:** S
  - **Files:** `TrainDetailPanel.tsx:117`
  - Only show `...` if string is actually truncated:
    ```typescript
    {train.tripId.length > 20 ? `${train.tripId.slice(0, 20)}...` : train.tripId}
    ```
  - **See:** [Review - Issue #3](#issue-3-missing-null-check-in-trip-id-truncation-low)

- [ ] **Add constants for magic numbers**
  - **Severity:** Low | **Effort:** S
  - **Files:** Various
  - Create `src/lib/constants.ts` entries for:
    - `TRIP_ID_DISPLAY_LENGTH = 20`
    - `POPUP_OFFSET = 15`
    - Document `DWELLING_THRESHOLD` better
  - **See:** [Review - Issue #7](#issue-7-magic-numbers-low)

- [ ] **Optimize animation loop**
  - **Severity:** Low | **Effort:** S
  - **Files:** `SubwayMap.tsx:86-105`
  - Skip animation frame if all trains are dwelling
  - Track animation state and pause loop when not needed
  - **See:** [Review - Issue #9](#issue-9-animation-loop-runs-continuously-low)

### Testing

- [ ] **Add unit tests for format utilities**
  - **Severity:** Low | **Effort:** M
  - **Files:** New test file `src/lib/mta/__tests__/format.test.ts`
  - Test cases:
    - `getDirectionFromStopId`: null, empty, 'N', 'S', no suffix, lowercase
    - `formatEta`: past times, 0, 1 min, many minutes, invalid
    - `formatTime`: valid ISO, invalid, null
  - **Depends on:** Extract shared utility functions task

- [ ] **Add integration tests for arrivals flow**
  - **Severity:** Low | **Effort:** L
  - **Files:** New test files
  - Test cases:
    - Station detail page renders arrivals
    - Empty arrivals shows "No upcoming arrivals"
    - Error state shows retry button
    - Refresh button triggers new fetch
  - **Depends on:** Test infrastructure setup

- [ ] **Add E2E tests for train selection**
  - **Severity:** Low | **Effort:** L
  - **Files:** New Playwright/Cypress tests
  - Test cases:
    - Click train marker opens panel
    - Click X closes panel
    - Click same train toggles panel
    - Panel updates when train data changes
  - **Depends on:** E2E test infrastructure

---

## Task Dependencies

```
Extract shared utilities
        │
        ├──▶ Add unit tests for format utilities
        │
        └──▶ Break up SubwayMap component
                    │
                    └──▶ Fix stale closure (easier after refactor)

Type API responses
        │
        └──▶ Add integration tests for arrivals

[No dependencies]
├── Optimize station arrivals API calls
├── Extract popup styles to CSS
├── Fix trip ID truncation display
├── Add constants for magic numbers
└── Optimize animation loop
```

---

## Notes

- Tasks marked with dependencies should be done in order
- High priority tasks should be completed before next major feature work
- Testing tasks can be done incrementally alongside feature work
- Performance optimizations (API calls, animation) can wait for user feedback
