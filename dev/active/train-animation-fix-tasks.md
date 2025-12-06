# Train Animation Fix - Task List

**Last Updated: 2025-12-06**

## Completed ✅

- [x] Fix undefined constants (STATION_THRESHOLD, ARRIVAL_THRESHOLD)
- [x] Change to distance-based phase detection
- [x] Create unit test with mock data (`train-state-machine.test.ts`)
- [x] Create integration test with real GTFS data (`real-data.test.ts`)
- [x] Complete code review (`dev/review/train-animation-state-machine/`)
- [x] Identify speed multiplier compounding bug

## In Progress 🔄

- [ ] **Fix speed multiplier compounding bug** ← CRITICAL, DO THIS FIRST
  - File: `src/lib/map/train-state-machine.ts`
  - Line: 315-322
  - Change: `speedMultiplier * adjustment` → bounded direct set

## Pending

- [ ] Add speed multiplier bounds test
- [ ] Run full test suite
- [ ] Test in browser
- [ ] Remove legacy animation system (low priority)
- [ ] Consolidate state updates (medium priority)

## Quick Reference

### Test Command
```bash
npx vitest run src/lib/map/real-data.test.ts
```

### Key Files
- State machine: `src/lib/map/train-state-machine.ts`
- Animation hook: `src/components/map/hooks/useMapAnimation.ts`
- Markers hook: `src/components/map/hooks/useTrainMarkers.ts`
- Real data test: `src/lib/map/real-data.test.ts`

### Bug Location
```
src/lib/map/train-state-machine.ts:315
```

```typescript
// LINE 315 - BUG:
speedMultiplier: state.speedMultiplier * adjustment

// SHOULD BE:
speedMultiplier: Math.max(0.5, Math.min(2.0, adjustment))
```
