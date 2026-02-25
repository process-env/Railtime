# Review Context: Session 2026-02-25

Last Updated: 2026-02-25

## Scope

Uncommitted working changes across 4 files on the `main` branch:

| File | Change Type |
|------|-------------|
| `src/app/api/v1/newsroom/segment/route.ts` | Config addition (`maxDuration`) |
| `src/app/api/v1/trains/route.ts` | Feature — stale fallback cache strategy |
| `src/components/layout/RouteFilter.tsx` | Style — layout change (flex → grid) |
| `src/components/newsroom/NewsroomProvider.tsx` | Robustness — audio playback + retry improvements |

## Architectural Context

- **Trains route**: Primary API for real-time train positions. Reads from Redis cache (20s TTL) with fallback to MTA GTFS-RT feeds. Supports single-group (`?groupId=ACE`) and all-groups paths. Partial cache strategy fetches only missing groups from MTA.
- **Newsroom segment route**: Generates TTS audio segments via OpenAI API. 6 segment types with varying cache policies. Called by `NewsroomProvider` on the client.
- **NewsroomProvider**: Client-side component managing a 1010 WINS-style broadcast loop: welcome stinger → news block → weather → transit insight → evergreen, then clock-aligned schedule.
- **RouteFilter**: UI component for filtering displayed subway routes. Used in sidebar (full layout) and compact map overlay.

## Related Files

- `src/app/api/v1/trains/route.test.ts` — 20 tests, needs updates for stale fallback
- `src/components/layout/RouteFilter.test.tsx` — 9 tests, may need grid-layout assertions
- `src/lib/redis.ts` — `getCache`/`setCache` (graceful degradation when Redis unavailable)
- `src/lib/mta/fetch-feed.ts` — GTFS-RT protobuf decode, 15s timeout, Redis caching
- `src/lib/mta/feed-groups.ts` — route → feed group mapping

## Recent Commit History

```
5abf695 style: increase route filter button gap for selected ring breathing room
0cdb548 fix: show total API train count (no filter) or filtered count (with filter)
a90b19e fix: hide queued terminal trains, keep only lead departure per route
69c0982 fix: show every positioned train on map — remove silent entry gate
619ba25 feat: instant welcome stinger to eliminate dead air on first click
40d9923 feat: clock-aligned newsroom broadcast schedule (1010 WINS style)
6547101 feat: replace conductor with unified newsroom broadcast system
```

## Constraints & Trade-offs

- MTA GTFS-RT feeds have no SLA; outages are common — motivates the stale fallback strategy
- OpenAI TTS returns base64 audio; large payloads (~200KB) sent to browser as data: URLs — motivates the blob URL conversion
- Vercel serverless has 10s default timeout; newsroom segment calls OpenAI twice (chat + TTS) — motivates `maxDuration = 30`
- RouteFilter renders 25 route buttons; flex-wrap caused inconsistent alignment — motivates grid layout
