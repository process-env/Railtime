# Production Fixes - Task List

**Last Updated**: 2025-12-06

## Completed Tasks

- [x] Fix React Compiler purity error in stations page (Date.now)
- [x] Fix React Compiler purity error in sidebar (Math.random)
- [x] Fix useMemo dependency in analytics page
- [x] Fix Sidebar.test.tsx mock for useAlerts hook
- [x] Remove unused phaseDisplay variable
- [x] Change `let s` to `const s` in alpha-beta-gamma.ts
- [x] Add eslint-disable for require imports in convert-shapes.js
- [x] Verify build passes
- [x] Verify all 421 tests pass

---

## Follow-Up Tasks

### High Priority

#### [ ] Add type definitions for test mocks
- **Category**: Tests
- **Severity**: High
- **Effort**: M
- **Description**: Replace `any` types in test files with proper TypeScript interfaces. Create shared mock utilities.
- **Acceptance Criteria**:
  - No `@typescript-eslint/no-explicit-any` errors in test files
  - Shared mock types in `src/test/types/`
- **Dependencies**: None

#### [ ] Document state machine disable reason
- **Category**: Docs
- **Severity**: High
- **Effort**: S
- **Description**: Add explanation to TROUBLESHOOTING.md about why state machine is disabled and conditions for re-enabling.
- **Acceptance Criteria**:
  - TROUBLESHOOTING.md has "Train Animation" section
  - Documents the BOARDING phase bug
  - Lists steps to re-enable
- **Dependencies**: None

---

### Medium Priority

#### [ ] Fix use-alerts.ts dependency warning
- **Category**: Refactor
- **Severity**: Medium
- **Effort**: S
- **Description**: Fix ESLint warning about `alerts` logical expression in useMemo dependencies.
- **Acceptance Criteria**:
  - No warnings in `src/hooks/use-alerts.ts`
  - Hook behavior unchanged
- **Dependencies**: None
- **See**: [Review Section: Alert Hook Dependency Warning](./production-fixes-review.md#7-alert-hook-dependency-warning)

#### [ ] Remove unused _request parameter
- **Category**: Cleanup
- **Severity**: Medium
- **Effort**: S
- **Description**: Remove unused `_request` parameter in analytics historical route.
- **File**: `src/app/api/v1/analytics/historical/route.ts`
- **Acceptance Criteria**:
  - Parameter removed or used
  - No lint warnings
- **Dependencies**: None

#### [ ] Consolidate animation systems
- **Category**: Refactor
- **Severity**: Medium
- **Effort**: L
- **Description**: The codebase has two animation systems. Once state machine bug is fixed, remove the legacy lerp system.
- **Acceptance Criteria**:
  - Single animation system
  - `trainAnimsRef` removed from useMapAnimation
  - All trains use state machine
- **Dependencies**: Fix state machine BOARDING bug first

---

### Low Priority

#### [ ] Add tests for useMapAnimation hook
- **Category**: Tests
- **Severity**: Low
- **Effort**: M
- **Description**: Create test file for animation hook covering phase transitions and edge cases.
- **File**: `src/components/map/hooks/useMapAnimation.test.ts`
- **Acceptance Criteria**:
  - Tests for lerp animation
  - Tests for motion state updates
  - Tests for phase transitions
- **Dependencies**: None

#### [ ] Add tests for useTrainMarkers hook
- **Category**: Tests
- **Severity**: Low
- **Effort**: L
- **Description**: Create test file for train markers hook.
- **File**: `src/components/map/hooks/useTrainMarkers.test.ts`
- **Acceptance Criteria**:
  - Tests for marker creation
  - Tests for motion state creation
  - Tests for segment changes
- **Dependencies**: None

#### [ ] Add JSDoc to animation functions
- **Category**: Docs
- **Severity**: Low
- **Effort**: S
- **Description**: Add documentation to key animation functions explaining thresholds and logic.
- **Functions**:
  - `getPhaseFromDistance()` - document 20m/200m thresholds
  - `updateMotionState()` - document segment change logic
- **Acceptance Criteria**:
  - JSDoc comments with @param and @returns
  - Threshold values explained
- **Dependencies**: None

---

## Task Summary

| Priority | Count | Categories |
|----------|-------|------------|
| High | 2 | Tests, Docs |
| Medium | 3 | Refactor, Cleanup |
| Low | 3 | Tests, Docs |

**Total**: 8 follow-up tasks

---

## Notes

- All blocking issues for production have been resolved
- State machine consolidation should wait until BOARDING bug is diagnosed
- Test coverage for map hooks is a known gap
