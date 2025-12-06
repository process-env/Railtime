# Map Components Review - Task Checklist

**Generated:** 2025-12-06

Use this checklist to track progress on review findings. Mark items `[x]` when complete.

---

## Priority 1: Critical (Do Immediately)

### Testing
- [ ] **Create test file structure**
  - [ ] `src/components/map/__tests__/SubwayMap.test.tsx`
  - [ ] `src/components/map/__tests__/TrainDetailPanel.test.tsx`
  - [ ] `src/components/map/hooks/__tests__/useMapAnimation.test.ts`
  - [ ] `src/components/map/hooks/__tests__/useTrainMarkers.test.ts`
  - [ ] `src/components/map/hooks/__tests__/useStationMarkers.test.ts`

- [ ] **useMapAnimation tests**
  - [ ] Phase transition: APPROACHING → ARRIVING → BOARDING
  - [ ] Dwell time at stations
  - [ ] Animation frame cleanup on unmount
  - [ ] Dynamic module loading failure handling

- [ ] **useTrainMarkers tests**
  - [ ] Marker creation for new train
  - [ ] Marker removal when train filtered out
  - [ ] Grace period for disappeared trains
  - [ ] Terminal detection accuracy
  - [ ] Route filter immediate removal

- [ ] **useStationMarkers tests**
  - [ ] Selection state visual updates
  - [ ] Arrival indicator animation
  - [ ] Zoom-based visibility toggle
  - [ ] Event listener cleanup

- [ ] **Integration tests**
  - [ ] Prefetch on hover → instant map load
  - [ ] Filter selection → marker removal
  - [ ] Train selection → detail panel sync

### State Machine Issue
- [ ] Investigate why boarding phase gets stuck (useTrainMarkers:482)
- [ ] Document root cause in code comments
- [ ] Either fix or add regression test for workaround
- [ ] Remove disabled code if unfixable

### Error Handling
- [ ] Wrap `getRouteTrack` calls in try-catch (useTrainMarkers:272-381)
- [ ] Wrap `getStopArclength` calls in try-catch
- [ ] Add AbortController for cleanup on unmount
- [ ] Show user-friendly error toast when track data fails

---

## Priority 2: High (This Sprint)

### Refactor useTrainMarkers (794 lines → smaller modules)
- [ ] Extract `createMotionState()` to separate file
- [ ] Extract `updateMotionState()` to separate file
- [ ] Extract `createPopupHTML()` to separate file
- [ ] Add TypeScript types for all function params
- [ ] Add JSDoc comments to public functions

### Consolidate Animation Systems
- [ ] Document decision: keep lerp vs α-β-γ vs both
- [ ] If keeping one: remove unused system
- [ ] If keeping both: document when each is used
- [ ] Update variable names (trainAnimsRef vs trainMotionRef confusion)

### Coordinate Background Sync
- [ ] Remove duplicate alerts polling from useBackgroundSync
- [ ] Ensure useAlerts refetchInterval matches background sync
- [ ] Add page visibility API check (pause when tab hidden)
- [ ] Document stale time strategy

---

## Priority 3: Medium (Next Sprint)

### Extract Constants to Configuration
- [ ] Create `src/lib/map/map-constants.ts`
- [ ] Move REFRESH_INTERVAL (15000ms)
- [ ] Move CULL_GRACE_PERIOD_MS (300000ms)
- [ ] Move ARRIVING_DISTANCE (200m)
- [ ] Move STATION_SNAP_DISTANCE (20m)
- [ ] Move phase polling interval (500ms)
- [ ] Document rationale for each value

### Clean Up Dead Code
- [ ] Verify trains-store.ts is unused
- [ ] Check if `updateTrains()` is ever called
- [ ] Remove store or add deprecation notice
- [ ] Update any tests that reference it

### Improve Error UX
- [ ] Add error boundary for map components
- [ ] Create MapErrorFallback component
- [ ] Display user-friendly error messages
- [ ] Add retry button for recoverable errors

### Terminal Stops Completeness
- [ ] Audit TERMINAL_STOPS list against GTFS data
- [ ] Add missing terminal stop IDs
- [ ] Consider generating from GTFS instead of hardcoding
- [ ] Add test to verify terminal detection

---

## Priority 4: Low (Backlog)

### Phase Colors
- [ ] Extract to shared constants file
- [ ] Update TrainDetailPanel.tsx:68-72
- [ ] Update useTrainMarkers.ts:762-763
- [ ] Update useMapAnimation.ts popup creation

### Dynamic Import Loading States
- [ ] Add loading state for motion utilities import
- [ ] Add retry logic for failed imports
- [ ] Show fallback UI during load

### Documentation
- [ ] Document animation system architecture
- [ ] Add README to map/hooks folder
- [ ] Document phase detection algorithm
- [ ] Document caching strategy

### Code Standards
- [ ] Replace `any` with `unknown` for dynamic imports
- [ ] Add JSDoc to all exported functions
- [ ] Prefer early returns over nested conditionals
- [ ] Remove unnecessary type assertions (`as`)

---

## Quick Wins (< 30 min each)

- [ ] Add inline comment explaining CULL_GRACE_PERIOD_MS value
- [ ] Add inline comment explaining ARRIVING_DISTANCE threshold
- [ ] Rename `trainAnimsRef` to `trainLerpRef` for clarity
- [ ] Add `console.error` context to dynamic import catches
- [ ] Remove unused imports in map hook files

---

## Metrics to Track

After implementing fixes, measure:

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Test coverage (map hooks) | 0% | - | >80% |
| useTrainMarkers lines | 794 | - | <300 |
| Magic numbers | 15+ | - | 0 |
| Console errors (production) | ? | - | 0 |

---

## Notes

- Do not break existing functionality while refactoring
- Run `npm run build` after each significant change
- Test on slow network to verify loading states
- Check memory usage in DevTools after long sessions
