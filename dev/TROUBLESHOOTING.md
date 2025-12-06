# Troubleshooting Guide

## Train Animation

### State Machine Disabled

**Location**: `src/components/map/hooks/useTrainMarkers.ts:484`

```typescript
// DISABLED: State machine causes trains to get stuck in BOARDING phase
const animState = null;
```

**Problem**: When enabled, trains get stuck in the BOARDING phase and stop moving to the next station.

**Root Cause**: Unknown. Suspected issue with dwell time logic or pending segment handling in `train-state-machine.ts`.

**Current Workaround**: The state machine is disabled (`animState = null`). Animation uses a simple lerp-based fallback that works correctly.

**How Phase Detection Works (Current)**:
The `getPhaseFromDistance()` function uses distance thresholds:
- `BOARDING`: Within 20 meters of station
- `ARRIVING`: Within 200 meters of station
- `APPROACHING`: More than 200 meters from station

This maps to display text:
- BOARDING -> "At Station"
- ARRIVING -> "Arriving"
- APPROACHING -> "En Route"

**To Re-enable State Machine**:
1. Fix the BOARDING phase bug in `train-state-machine.ts`
2. Change line 484 in `useTrainMarkers.ts` to use `createTrainAnimationState()`
3. Test thoroughly - watch trains for 5+ minutes
4. Verify trains transition through all phases correctly

**Related Files**:
- `src/lib/map/train-state-machine.ts` - State machine reducer
- `src/components/map/hooks/useMapAnimation.ts` - Animation loop
- `dev/active/train-animation-context.md` - Full context

---

## Historical Analytics Endpoint

**Location**: `src/app/api/v1/analytics/historical/route.ts`

**Problem**: Endpoint takes 49+ seconds due to schedule lookup operations.

**Current State**: DISABLED - returns empty data immediately.

**To Fix**:
1. Optimize the schedule lookup queries
2. Consider caching or pre-computing data
3. Re-enable the endpoint when performance is acceptable

---

## React Compiler Purity Errors

The React Compiler is stricter about function purity than standard ESLint.

### Common Issues

**Date.now() in useMemo**:
```typescript
// BAD - React Compiler flags this
const data = useMemo(() => {
  const now = Date.now();  // Impure!
}, [dependency]);

// OK - With eslint-disable and explanation
// eslint-disable-next-line react-hooks/purity -- intentional
const data = useMemo(() => { ... }, [dependency]);
```

**Math.random() in components**:
Use `React.useId()` to generate deterministic values based on component identity.

---

## Test Mock Issues

### Zustand Store Mocks

When stores are refactored, tests may fail if they set properties that no longer exist.

**Pattern for mocking hooks with mutable state**:
```typescript
const mockState = { data: [] };
vi.mock('@/hooks', async () => ({
  ...await vi.importActual('@/hooks'),
  useMyHook: () => ({ data: mockState.data }),
}));

// In test:
mockState.data = [newItem];
```

### vi.mock Hoisting

`vi.mock` calls are hoisted. You cannot reference variables declared after the mock.

```typescript
// BAD - array is declared after vi.mock but mock runs first
const array = [];
vi.mock('...', () => ({ fn: () => array }));  // array is undefined!

// GOOD - use object to hold mutable reference
const state = { array: [] };
vi.mock('...', () => ({ fn: () => state.array }));
```
