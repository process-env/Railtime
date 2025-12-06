# Train Animation State Machine - Task List

**Last Updated: 2025-12-06**

## Critical Priority

### Bug Fixes

- [ ] **Fix speed multiplier compounding bug**
  - Severity: Critical | Effort: S
  - File: `src/lib/map/train-state-machine.ts:312-322`
  - Issue: `speedMultiplier * adjustment` compounds on each API update
  - Fix: Replace with direct assignment, add bounds (0.5-2.0)
  - See: [Review - Issue #2](./train-animation-review.md#2-speed-multiplier-accumulation-bug)

- [ ] **Consolidate state updates in useTrainMarkers**
  - Severity: High | Effort: M
  - File: `src/components/map/hooks/useTrainMarkers.ts:274-287`
  - Issue: Three separate reducer dispatches per API cycle
  - Fix: Add duration/speed to API_UPDATE action, dispatch once
  - See: [Review - Issue #3](./train-animation-review.md#3-double-state-update-in-usetrainmarkers)

---

## High Priority

### Architecture Cleanup

- [ ] **Remove legacy animation system**
  - Severity: High | Effort: L
  - Files: `useMapAnimation.ts`, `useTrainMarkers.ts`
  - Issue: Two animation systems running simultaneously
  - Fix: Remove `TrainAnimState`, `trainAnimsRef`, `createLegacyMarker()`
  - Depends on: Verify all routes work with new system
  - See: [Review - Issue #4](./train-animation-review.md#4-dual-animation-systems-running)

- [ ] **Replace module-level mutable state**
  - Severity: High | Effort: M
  - File: `src/components/map/hooks/useTrainMarkers.ts:49-56`
  - Issue: `let getRouteTrack = null` etc. can cause SSR issues
  - Fix: Use lazy initialization inside hook or context
  - See: [Review - Issue #5](./train-animation-review.md#5-module-level-mutable-state)

---

## Medium Priority

### Code Quality

- [ ] **Update documentation comments**
  - Severity: Medium | Effort: S
  - File: `src/lib/map/train-state-machine.ts:7-11`
  - Issue: Comments mention AT_STATION/DEPARTING but type has BOARDING
  - Fix: Update comments to match actual implementation

- [ ] **Remove dead code**
  - Severity: Medium | Effort: S
  - Files: `useMapAnimation.ts:32-35`, `useMapAnimation.ts:17`
  - Items:
    - [ ] Remove `plan: MotionPlan | null` field
    - [ ] Remove `evaluatePlan` import
    - [ ] Remove unused `TrainAnimationState` import
  - See: [Review - Issues #7, #8](./train-animation-review.md#7-dead-code--deprecated-fields)

- [ ] **Remove unused ROUTE_STOP_PREFIXES**
  - Severity: Low | Effort: S
  - File: `src/lib/map/track-index.ts:149-174`
  - Issue: Defined but never used in logic
  - Decision: Either use it or delete it

- [ ] **Fix async forEach pattern**
  - Severity: Medium | Effort: S
  - File: `src/components/map/hooks/useTrainMarkers.ts:247`
  - Issue: `forEach(async ...)` loses promise handling
  - Fix: Use `Promise.all(trains.map(async ...))` or `for...of`
  - See: [Review - Issue #10](./train-animation-review.md#10-async-in-foreach-loop)

---

## Low Priority

### Tests

- [ ] **Add speed multiplier bounds test**
  - Severity: Medium | Effort: S
  - File: `src/lib/map/train-state-machine.test.ts`
  - Test: Verify multiplier stays bounded after 10+ API updates

- [ ] **Add segment change while BOARDING test**
  - Severity: Medium | Effort: S
  - Test: Verify pendingSegment is cached and applied after dwell

- [ ] **Add sync snap (>30% discrepancy) test**
  - Severity: Low | Effort: S
  - Test: Verify hard snap to API position

- [ ] **Optimize test file loading**
  - Severity: Low | Effort: S
  - File: `src/lib/map/real-data.test.ts`
  - Issue: Each test reads files separately
  - Fix: Use `beforeAll` to load once

---

## Documentation

- [ ] **Add time units comment**
  - Severity: Low | Effort: S
  - File: `src/lib/map/train-state-machine.ts`
  - Add: Comment clarifying seconds vs milliseconds fields

---

## Dependency Graph

```
Fix speed multiplier bug
         ↓
Consolidate state updates
         ↓
Remove legacy animation system
         ↓
Add comprehensive tests
```

---

## Quick Wins (< 30 min each)

1. Update documentation comments
2. Remove dead code (plan field, unused imports)
3. Add speed multiplier bounds test
4. Fix async forEach pattern

---

## Notes

- All tasks link back to detailed explanations in `train-animation-review.md`
- Priority based on impact to "zig-zag" bug
- Effort: S (<1hr), M (1-4hr), L (4-8hr), XL (>8hr)
