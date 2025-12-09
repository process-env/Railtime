# Handoff Notes - Active Development

**Last Updated**: 2025-12-09T15:35:00Z

---

## CURRENT ACTIVE TASK: Trip Advisor Agent

**Status**: PLANNING COMPLETE - Ready for Implementation
**Documentation**: `dev/active/trip-advisor-agent/`

### What Was Being Worked On

Building a Trip Advisor Agent for the NYC Subway tracker that calculates optimal routes between stations using Dijkstra's algorithm.

### Exact State When Context Limit Hit

- Plan was just approved by user
- Todo list created with 12 tasks
- About to start first task: `scripts/build-transfer-graph.ts`
- **NO CODE HAS BEEN WRITTEN YET**

### Key Files Created This Session

| File | Purpose |
|------|---------|
| `C:\Users\User\.claude\plans\foamy-drifting-bonbon.md` | Full detailed implementation plan |
| `dev/active/trip-advisor-agent/trip-advisor-agent-context.md` | Current state + decisions |
| `dev/active/trip-advisor-agent/trip-advisor-agent-tasks.md` | Task checklist |
| `dev/active/trip-advisor-agent/trip-advisor-agent-plan.md` | Quick reference + transfer data |

### Design Decisions (User Confirmed)
1. **UI Location**: Sidebar panel
2. **Real-time Integration**: Yes - adjust for service alerts
3. **Transfer Data**: Comprehensive - all 30+ complexes

### Next Immediate Steps

1. Create `scripts/build-transfer-graph.ts` with hardcoded transfer data
2. Validate station IDs against `public/data/stops.txt`
3. Generate `public/data/transfer-graph.json`
4. Create `scripts/build-route-segments.ts`
5. Generate `public/data/route-segments.json`

### Commands to Resume

```bash
cd C:/Users/User/Documents/RND/_dev_/TS/traintracker

# Read the context
cat dev/active/trip-advisor-agent/trip-advisor-agent-context.md

# Read the full plan
cat C:\Users\User\.claude\plans\foamy-drifting-bonbon.md
```

---

## PREVIOUS TASK: Train Animation Fix

**Status**: CODE REVIEW COMPLETE - 4 CRITICAL BUGS FOUND
**Documentation**: `dev/active/train-animation-fix/`

### Critical Bugs Found

1. **BUG 1**: speedMultiplier uses wrong calculation in `useTrainMarkers.ts:273-274`
2. **BUG 2**: State machine hardcodes 90s in `train-state-machine.ts:96-97`
3. **BUG 3**: Duplicate state between TrainMotionState and TrainAnimationState
4. **BUG 4**: Wrong thresholds (0.95 should be 0.8, 0.99 should be 1.0)

### Plan Location
`C:\Users\User\.claude\plans\nested-plotting-aho.md`

---

## Project Quick Reference

### Key Data Files
- `public/data/stops.txt` - 243 parent stations, 1,497 total stops
- `public/data/routes.txt` - 31 transit routes
- `public/data/stop_times.txt` - 562,335 stop-time entries (35 MB)
- `public/data/duration-matrix.json` - Pre-computed segment times (6.1 MB)
- `public/data/stations-enriched.json` - Cross-street enrichment

### Key Source Files
- `src/lib/mta/station-utils.ts` - Station ID parsing utilities
- `src/lib/map/route-durations.ts` - Duration matrix loading
- `scripts/build-duration-matrix.ts` - GTFS parsing pattern
- `src/stores/ui-store.ts` - Zustand store pattern
- `src/lib/api/index.ts` - API client

### Development Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run test:run     # Run tests
npx ts-node scripts/build-duration-matrix.ts  # Build GTFS data
```
