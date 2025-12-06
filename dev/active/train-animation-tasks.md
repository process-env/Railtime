# Train Animation System - Task List

**Last Updated**: 2025-12-06T18:00:00Z

## STATUS: ROOT CAUSE IDENTIFIED - FIX READY

The zig-zag is caused by dual position updates. Remove the legacy block.

---

## IMMEDIATE FIX (Do First)

### [ ] Remove Dual Update Block
**File**: `useTrainMarkers.ts:539-552`

**Remove this entire block:**
```typescript
if (segmentChanged && prevS !== undefined) {
  const newS = prevS + (nextS - prevS) * apiProgress;
  state.filter.s = newS;
  state.filter.v = 0;
  state.filter.a = 0;
  state.prevS = prevS;
  state.nextS = nextS;
}
```

**Why**: This block directly modifies `filter.s` AFTER the state machine already handled it, causing position conflicts.

**After removing**:
1. Run `npm run build` - should pass
2. Run `npx vitest run` - should pass
3. Test in browser for 5+ minutes
4. Trains should move smoothly, no zig-zag

---

## COMPLETED ✅

- [x] Create `src/lib/map/route-durations.ts` - builds duration matrix
- [x] Create `src/lib/map/alert-speed.ts` - speed multiplier from alerts
- [x] Create `src/lib/map/train-state-machine.ts` - state machine logic
- [x] Fix speed multiplier compounding (`train-state-machine.ts:319`)
- [x] Add test for speed multiplier bounds
- [x] Complete code review (`dev/review/map-components-2024-12/`)

---

## AFTER FIX WORKS (Priority Order)

### Priority 1: Test Coverage
- [ ] Create `useTrainMarkers.test.ts`
- [ ] Create `useMapAnimation.test.ts`
- [ ] Create `useStationMarkers.test.ts`
- [ ] Add integration test for full map flow

### Priority 2: Consolidate Animation Systems
- [ ] Document which system to keep (lerp vs α-β-γ)
- [ ] Remove unused system
- [ ] Update variable names for clarity

### Priority 3: Refactor useTrainMarkers
- [ ] Extract `createMotionState()` to separate file
- [ ] Extract `updateMotionState()` to separate file
- [ ] Extract `createPopupHTML()` to separate file
- [ ] Reduce file from 794 lines to <300

### Priority 4: Extract Constants
- [ ] Create `map-constants.ts`
- [ ] Move all magic numbers
- [ ] Document rationale for each value

---

## KEY FILES

| File | Status | Notes |
|------|--------|-------|
| `useTrainMarkers.ts` | ❌ FIX NEEDED | Remove lines 539-552 |
| `useMapAnimation.ts` | ✅ Works | Reads from state machine |
| `train-state-machine.ts` | ✅ Fixed | Speed multiplier bounded |
| `route-durations.ts` | ✅ Works | Duration lookup |
| `alert-speed.ts` | ✅ Works | Alert modulation |

---

## VERIFICATION CHECKLIST

After applying fix:
- [ ] `npm run build` passes
- [ ] `npx vitest run` passes
- [ ] Browser: trains move smoothly toward stations
- [ ] Browser: no zig-zag (watch 5+ minutes)
- [ ] Browser: trains reach exact station positions
- [ ] Browser: popup shows correct phase (BOARDING at station)

---

## DOCUMENTATION LOCATIONS

| Document | Location |
|----------|----------|
| Root cause analysis | `dev/active/train-animation-context.md` |
| Code review | `dev/review/map-components-2024-12/` |
| Main handoff | `dev/HANDOFF.md` |
| Legacy handoff | `dev/active/handoff-notes.md` |
