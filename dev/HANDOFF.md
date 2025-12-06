# Handoff Notes - Train Animation Fix

**Date: 2025-12-06**
**Status: ROOT CAUSE FOUND - Dual Update Conflict**

## IMMEDIATE NEXT ACTION

**Remove the dual position update block in `useTrainMarkers.ts:539-552`:**

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

This is the ROOT CAUSE of zig-zag. Both state machine AND this legacy code update position, causing conflict.

## What Was Fixed This Session

1. **Speed multiplier compounding** - FIXED at line 319
   - Changed `state.speedMultiplier * adjustment` to `Math.max(0.5, Math.min(2.0, adjustment))`
   - Test added and passes

2. **Root cause analysis completed** - see review at `dev/review/train-animation-integration/`

## What's Still Broken

**ZIG-ZAG STILL HAPPENING** because:
- State machine dispatches `API_UPDATE` (correct)
- BUT `useTrainMarkers.ts:539-552` ALSO directly modifies `state.filter.s`, `state.prevS`, `state.nextS`
- Animation loop reads from state machine but bounds are corrupted

## Files Modified This Session

| File | Change |
|------|--------|
| `src/lib/map/train-state-machine.ts:319` | Fixed speed multiplier compounding |
| `src/lib/map/train-state-machine.test.ts` | Added speed multiplier bounds test |

## Key Reviews Created

| Location | Content |
|----------|---------|
| `dev/review/train-animation-integration/` | Full integration review with root cause |
| `dev/review/train-animation-integration/train-animation-integration-tasks.md` | 16 tasks, Phase 1 is the fix |

## Test Commands

```bash
# Run all state machine tests
npx vitest run src/lib/map/train-state-machine.test.ts

# Run real data tests
npx vitest run src/lib/map/real-data.test.ts

# Kill dev servers
taskkill //F //IM node.exe

# Start dev
npm run dev
```

## Current State

- Dev server running at http://localhost:3000
- Tests pass but browser still shows zig-zag
- The fix (remove lines 539-552) has NOT been applied yet

## User Context

- Frustrated after multiple sessions
- Wants to SEE results, not hear "it works"
- Still seeing zig-zag in browser

## Architecture Summary

```
INTENDED:
API → useTrainMarkers (dispatch API_UPDATE) → State Machine → Animation Loop → Marker

ACTUAL (BROKEN):
API → useTrainMarkers (dispatch API_UPDATE) → State Machine
                     ↓
         ALSO directly updates filter.s, prevS, nextS  ← CONFLICT!
                     ↓
Animation Loop reads state machine but bounds corrupted → ZIG-ZAG
```

## Next Steps

1. Remove lines 539-552 in `useTrainMarkers.ts`
2. Run tests
3. Test in browser for 5+ minutes
4. If fixed, proceed to cleanup (remove legacy system)
