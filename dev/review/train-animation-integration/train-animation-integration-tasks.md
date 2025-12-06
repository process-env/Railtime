# Train Animation Integration - Task List

**Last Updated: 2025-12-06**

---

## Phase 1: Fix Root Cause (CRITICAL)

### 1.1 Remove Dual Position Update
- [ ] **Remove direct filter/arclength updates on segment change**
  - File: `src/components/map/hooks/useTrainMarkers.ts`
  - Lines: 539-552
  - Severity: CRITICAL
  - Effort: S
  - Description: Remove the block that directly modifies `state.filter.s`, `state.prevS`, `state.nextS` on segment change. Let state machine handle this via `API_UPDATE`.
  - Acceptance: Segment changes only dispatch to state machine, no direct state mutation

```typescript
// REMOVE THIS ENTIRE BLOCK (lines 539-552):
if (segmentChanged && prevS !== undefined) {
  const newS = prevS + (nextS - prevS) * apiProgress;
  state.filter.s = newS;
  state.filter.v = 0;
  state.filter.a = 0;
  state.prevS = prevS;
  state.nextS = nextS;
}
```

### 1.2 Verify State Machine is Source of Truth
- [ ] **Confirm animation loop reads only from state machine**
  - File: `src/components/map/hooks/useMapAnimation.ts`
  - Lines: 202-219
  - Severity: HIGH
  - Effort: S
  - Acceptance: `getCurrentArclength(state.animState)` is sole source of position

---

## Phase 2: Test & Verify

### 2.1 Run Existing Tests
- [ ] Run: `npx vitest run src/lib/map/train-state-machine.test.ts`
- [ ] Run: `npx vitest run src/lib/map/real-data.test.ts`
- [ ] Verify all tests pass

### 2.2 Browser Test
- [ ] Kill dev servers: `taskkill //F //IM node.exe`
- [ ] Start fresh: `npm run dev`
- [ ] Watch trains for 5+ minutes
- [ ] Verify NO zig-zag behavior
- [ ] Verify trains stop at station dots

---

## Phase 3: Consolidate State Updates

### 3.1 Single Dispatch Per API Update
- [ ] **Add duration/speed to API_UPDATE action**
  - File: `src/lib/map/train-state-machine.ts`
  - Severity: MEDIUM
  - Effort: M
  - Description: Extend API_UPDATE to include optional duration and speedMultiplier
  - Acceptance: Single dispatch instead of 3 per API cycle

### 3.2 Update useTrainMarkers
- [ ] **Use single consolidated dispatch**
  - File: `src/components/map/hooks/useTrainMarkers.ts`
  - Lines: 274-287
  - Severity: MEDIUM
  - Effort: M
  - Depends: 3.1

---

## Phase 4: Remove Legacy System

### 4.1 Remove Legacy Types
- [ ] Remove `TrainAnimState` interface
  - File: `useMapAnimation.ts:62-76`
  - Severity: LOW
  - Effort: S

### 4.2 Remove Legacy Refs
- [ ] Remove `trainAnimsRef`
  - File: `useMapAnimation.ts`
  - Severity: LOW
  - Effort: S

### 4.3 Remove Legacy Marker Creation
- [ ] Remove `createLegacyMarker()`
  - File: `useTrainMarkers.ts:568-632`
  - Severity: LOW
  - Effort: S

### 4.4 Remove Legacy Animation Branch
- [ ] Remove legacy animation in `animateTrains()`
  - File: `useMapAnimation.ts:176-190`
  - Severity: LOW
  - Effort: S

---

## Phase 5: Cleanup

### 5.1 Remove Redundant State
- [ ] Remove duplicate `prevS/nextS` from `TrainMotionState`
  - File: `useMapAnimation.ts:40-41`
  - Severity: MEDIUM
  - Effort: M
  - Description: Read from `animState.prevS/nextS` instead

### 5.2 Remove Unused Filter Fields
- [ ] Remove `filter.v` and `filter.a` (always 0)
  - Files: Multiple
  - Severity: LOW
  - Effort: S

### 5.3 Fix Documentation
- [ ] Update comments (AT_STATION/DEPARTING → BOARDING)
  - File: `train-state-machine.ts:7-11`
  - Severity: LOW
  - Effort: S

---

## Progress Summary

| Phase | Status | Done | Total |
|-------|--------|------|-------|
| Phase 1 | Not Started | 0 | 2 |
| Phase 2 | Not Started | 0 | 5 |
| Phase 3 | Not Started | 0 | 2 |
| Phase 4 | Not Started | 0 | 4 |
| Phase 5 | Not Started | 0 | 3 |
| **Total** | **Not Started** | **0** | **16** |

---

## Quick Commands

```bash
# Run tests
npx vitest run src/lib/map/train-state-machine.test.ts
npx vitest run src/lib/map/real-data.test.ts

# Kill dev servers
taskkill //F //IM node.exe

# Start dev
npm run dev
```

---

## Notes

- **Phase 1 is the fix** - removing the dual update is the cure for zig-zag
- **Phase 2 verifies** - must see NO zig-zag in browser
- **Phases 3-5 are cleanup** - can be done later
- The state machine logic is CORRECT - the problem is the integration
