# Train Popup Status Fix Plan

**Last Updated: 2025-12-06**

## Executive Summary

Fix train popup to display proper status labels (En Route/Arriving/At Station) instead of showing incorrect states or raw time values.

## Current State Analysis

### Problem
- Popup showed "At Station" when train was still between stations
- Popup showed raw "1 min" instead of "Arriving" label
- Popup showed raw "X mins" instead of "En Route" label with time
- The `Math.round()` caused 24-second ETA to round to 0, triggering wrong "At Station" state

### Root Cause
In `createPopupHTML()` at line 701:
```typescript
${derivedPhase === 'BOARDING' ? 'At Station' : formatEta(train.eta)}
```
This only showed a label for BOARDING, all other states showed raw time.

## Proposed Future State

Popup displays clear status progression:
- **En Route · X mins** (green) - more than 1 minute away
- **Arriving** (green) - within 1 minute
- **At Station** (amber) - ETA <= 0

## Implementation (COMPLETED)

### Fix Applied
File: `src/components/map/hooks/useTrainMarkers.ts` line 701-703

**Before:**
```typescript
${derivedPhase === 'BOARDING' ? 'At Station' : formatEta(train.eta)}
```

**After:**
```typescript
${derivedPhase === 'BOARDING' ? 'At Station' :
  derivedPhase === 'ARRIVING' ? 'Arriving' :
  'En Route · ' + formatEta(train.eta)}
```

## Phase Thresholds

Current thresholds in phase calculation (lines 659-666):
- `diffMins <= 0` → BOARDING → "At Station"
- `diffMins === 1` → ARRIVING → "Arriving"
- `diffMins > 1` → APPROACHING → "En Route · X mins"

## Success Metrics

- [ ] Train between stations shows "En Route · X mins"
- [ ] Train within 1 min shows "Arriving"
- [ ] Train at station (ETA <= 0) shows "At Station"
- [ ] No conflicting/duplicate status displays
- [ ] Status updates in real-time as train progresses

## Files Modified

| File | Change |
|------|--------|
| `src/components/map/hooks/useTrainMarkers.ts:701-703` | Updated popup display logic |

## Known Limitations

1. Phase detection relies on ETA from API - if API ETA is wrong, display will be wrong
2. `Math.round()` means 30-second boundaries determine transitions
3. No visual position-based detection - purely time-based
