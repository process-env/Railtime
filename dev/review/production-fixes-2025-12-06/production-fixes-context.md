# Production Fixes Context

**Last Updated**: 2025-12-06

## What Was Reviewed

### Files Modified

| File | Changes |
|------|---------|
| `src/app/(dashboard)/stations/page.tsx` | Fixed React Compiler purity error (Date.now) |
| `src/app/(dashboard)/analytics/page.tsx` | Fixed useMemo dependency pattern |
| `src/components/ui/sidebar.tsx` | Fixed Math.random purity error |
| `src/components/layout/Sidebar.test.tsx` | Fixed test mocks for useAlerts hook |
| `src/components/map/hooks/useTrainMarkers.ts` | Removed unused variable |
| `src/lib/map/alpha-beta-gamma.ts` | Changed let to const |
| `src/lib/map/train-state-machine.ts` | Reverted thresholds to original values |
| `scripts/convert-shapes.js` | Added eslint-disable for require imports |

### Context

This review covers fixes applied to make the codebase production-ready. The session began with a failed attempt to re-enable the state machine animation system, which was then reverted to preserve the working system.

## Architectural Context

### Animation System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Train Animation Flow                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  API Data → useTrainMarkers → Motion State → Animation Loop │
│                    │                              │          │
│                    ▼                              ▼          │
│              getPhaseFromDistance()         lerp animation   │
│                    │                              │          │
│                    ▼                              ▼          │
│              BOARDING | ARRIVING | APPROACHING   Marker pos  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Decision**: State machine (`train-state-machine.ts`) is DISABLED because trains get stuck in BOARDING phase. The simple distance-based `getPhaseFromDistance()` function works correctly.

### State Management

```
Server State (React Query):
├── useTrainPositions() → /api/v1/trains
├── useAlerts() → /api/v1/alerts
└── useStaticData() → static GTFS data

UI State (Zustand):
├── useUIStore → selectedRouteIds, sidebarOpen, selectedTrainId
└── useAlertsStore → dismissedIds
```

## Related Context

### Previous Reviews
- `dev/review/map-components-2024-12/` - Full map component review
- `dev/review/train-animation-state-machine/` - State machine analysis

### Known Constraints

1. **State Machine Bug**: Trains get stuck in BOARDING phase
   - Root cause: Unclear, potentially dwell time logic
   - Workaround: Disabled state machine, using lerp fallback

2. **React Compiler Strictness**: The React Compiler is stricter than standard ESLint rules
   - Date.now() and Math.random() flagged as impure
   - Requires explicit eslint-disable with rationale

3. **Test Mock Limitations**: vi.mock is hoisted, so mutable objects needed for dynamic test state

## Trade-offs Made

### 1. eslint-disable for Date.now()
**Decision**: Add eslint-disable with explanation
**Alternative**: Use useEffect + useState for time
**Rationale**: The memo recalculates every 15s when trains refresh, so stale time is acceptable

### 2. Deterministic skeleton widths
**Decision**: Hash component ID for width
**Alternative**: Pass width as prop
**Rationale**: Self-contained solution, no API changes needed

### 3. Keep state machine code but disabled
**Decision**: Comment out activation, keep code
**Alternative**: Delete state machine entirely
**Rationale**: Allows future re-enabling when bug is fixed

## References

### Related Files
- `dev/active/train-animation-context.md` - Animation system documentation
- `dev/active/train-animation-tasks.md` - Pending animation tasks

### External Resources
- [React Compiler docs](https://react.dev/reference/react/compiler) - Purity requirements
- [Zustand patterns](https://docs.pmnd.rs/zustand/getting-started/introduction) - State management
