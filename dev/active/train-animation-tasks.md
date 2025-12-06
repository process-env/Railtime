# Train Animation System - Task List

**Last Updated**: 2025-12-06T14:30:00Z

## STATUS: BROKEN - CRITICAL BUGS FOUND

Files exist but are broken. Code review revealed 4 major bugs.

---

## COMPLETED (BUT BROKEN)

- [x] Create `src/lib/map/route-durations.ts` - EXISTS, works
- [x] Create `src/lib/map/alert-speed.ts` - EXISTS but WRONG approach
- [x] Create `src/lib/map/train-state-machine.ts` - EXISTS but BUGGY
- [x] Modify useMapAnimation.ts - EXISTS but not synced with state machine
- [x] Modify useTrainMarkers.ts - EXISTS but wrong speedMultiplier calc

---

## BUGS TO FIX (Priority 1 - CRITICAL)

### BUG 1: speedMultiplier Uses Alerts Instead of API Timing
**File**: `useTrainMarkers.ts:273-274`
```typescript
// WRONG - uses alerts
existingMotion.speedMultiplier = getRouteSpeedMultiplier(alerts, train.routeId);
```
**Fix**:
```typescript
const apiDuration = (train.nextTimeMs - train.prevTimeMs) / 1000;
const scheduledDuration = getSegmentDuration(matrix, ...) || 90;
const speedMultiplier = apiDuration > 0 ? scheduledDuration / apiDuration : 1.0;
```

### BUG 2: State Machine Uses Hardcoded 90s Duration
**File**: `train-state-machine.ts:96-97`
- `scheduledDuration: 90` is hardcoded
- GTFS duration is set on TrainMotionState but NEVER passed to state machine
**Fix**: Pass duration to createTrainAnimationState()

### BUG 3: Duplicate State Not Synced
- `TrainMotionState` has: scheduledDuration, speedMultiplier, segmentStartTime
- `TrainAnimationState` has: scheduledDuration, speedMultiplier, segmentStartTime
- Updates to TrainMotionState don't update TrainAnimationState!
**Fix**: Remove duplicates, use only state machine

### BUG 4: Wrong Thresholds
**File**: `train-state-machine.ts:66-67`
- `ARRIVAL_THRESHOLD = 0.95` (should be 0.8)
- `STATION_THRESHOLD = 0.99` (should be 1.0)
**Fix**: Change to 0.8 and 1.0

---

## TASKS TO COMPLETE

### 1. [ ] Fix train-state-machine.ts
- [ ] Change ARRIVAL_THRESHOLD to 0.8
- [ ] Change STATION_THRESHOLD to 1.0
- [ ] Rename AT_STATION → BOARDING
- [ ] Remove DEPARTING state entirely
- [ ] Accept scheduledDuration and speedMultiplier in createTrainAnimationState()

### 2. [ ] Fix useTrainMarkers.ts
- [ ] Calculate speedMultiplier = scheduledDuration / apiDuration
- [ ] Pass duration to createTrainAnimationState()
- [ ] Dispatch SET_DURATION on each API update
- [ ] Dispatch SET_SPEED_MULTIPLIER on each API update

### 3. [ ] Fix useMapAnimation.ts
- [ ] Remove duplicate fields from TrainMotionState
- [ ] Read scheduledDuration/speedMultiplier from animState only

### 4. [ ] Test
- [ ] Verify trains reach stations
- [ ] Verify no zig-zag
- [ ] Verify boarding state caches API updates

---

## Key Files

| File | Status |
|------|--------|
| `src/lib/map/route-durations.ts` | ✅ Works |
| `src/lib/map/alert-speed.ts` | ❌ Wrong approach - use API timing |
| `src/lib/map/train-state-machine.ts` | ❌ Hardcoded 90s, wrong thresholds |
| `src/components/map/hooks/useMapAnimation.ts` | ❌ Duplicate state |
| `src/components/map/hooks/useTrainMarkers.ts` | ❌ Wrong speedMultiplier calc |

---

## PLAN FILE

See: `C:\Users\User\.claude\plans\nested-plotting-aho.md`
