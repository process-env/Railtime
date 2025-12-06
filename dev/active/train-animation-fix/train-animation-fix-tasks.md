# Train Animation Fix - Task Checklist

**Last Updated: 2025-12-06**

---

## Phase 1: Critical Bug Fixes

### 1.1 Speed Multiplier Bug
- [x] **Fix speed multiplier compounding** - DONE
  - File: `src/lib/map/train-state-machine.ts:319`
  - Changed: `state.speedMultiplier * adjustment` → `Math.max(0.5, Math.min(2.0, adjustment))`
  - Test added and passes

### 1.2 Dual Update Conflict (ROOT CAUSE OF ZIG-ZAG)
- [ ] **Remove legacy position update block** ← DO THIS NEXT
  - File: `src/components/map/hooks/useTrainMarkers.ts`
  - Lines: 539-552
  - Priority: CRITICAL
  - Effort: S
  - Remove entire block:
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

---

## Phase 2: Verification

### 2.1 Run Tests
- [x] Run: `npx vitest run src/lib/map/train-state-machine.test.ts` - PASSES
- [x] Run: `npx vitest run src/lib/map/real-data.test.ts` - PASSES
- [ ] Run tests AFTER removing dual update block

### 2.2 Browser Testing
- [ ] Kill dev servers: `taskkill //F //IM node.exe`
- [ ] Start fresh: `npm run dev`
- [ ] Watch trains for 5+ minutes
- [ ] Verify NO zig-zag behavior
- [ ] Verify trains stop at station dots
- [ ] Verify popup shows correct phase

---

## Phase 3: Code Cleanup [NOT STARTED]

### 3.1 Consolidate State Updates
- [ ] Add duration/speed to API_UPDATE action type
  - File: `src/lib/map/train-state-machine.ts`
  - Priority: Medium
  - Effort: M

- [ ] Update useTrainMarkers to use single dispatch
  - File: `src/components/map/hooks/useTrainMarkers.ts`
  - Lines: 274-287
  - Priority: Medium
  - Effort: M

### 3.2 Remove Legacy System
- [ ] Remove `TrainAnimState` interface
- [ ] Remove `trainAnimsRef`
- [ ] Remove `createLegacyMarker()`
- [ ] Remove legacy animation branch

### 3.3 Remove Redundant State
- [ ] Remove duplicate `prevS/nextS` from TrainMotionState
- [ ] Remove `filter.v` and `filter.a` (always 0)

### 3.4 Documentation
- [ ] Update comments (AT_STATION → BOARDING)

---

## Quick Reference

### Bug Fix Code (DONE)
```typescript
// src/lib/map/train-state-machine.ts:319
// FIXED:
speedMultiplier: Math.max(0.5, Math.min(2.0, adjustment)),
```

### Root Cause Fix (TODO)
```typescript
// src/components/map/hooks/useTrainMarkers.ts:539-552
// REMOVE ENTIRE BLOCK
```

### Test Commands
```bash
npx vitest run src/lib/map/train-state-machine.test.ts
npx vitest run src/lib/map/real-data.test.ts
taskkill //F //IM node.exe
npm run dev
```

---

## Progress Summary

| Phase | Status | Tasks Done | Total Tasks |
|-------|--------|------------|-------------|
| Phase 1 | In Progress | 1 | 2 |
| Phase 2 | Partial | 2 | 6 |
| Phase 3 | Not Started | 0 | 8 |
| **Total** | **In Progress** | **3** | **16** |

---

## Key Insight

The state machine logic is CORRECT. The zig-zag is caused by **dual position updates**:
1. State machine gets API_UPDATE (correct)
2. Legacy code ALSO updates position directly (WRONG - creates conflict)

Remove the legacy code at lines 539-552 to fix zig-zag.
