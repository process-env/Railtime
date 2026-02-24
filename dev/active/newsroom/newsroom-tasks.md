# Unified Newsroom — Tasks
Last Updated: 2026-02-24

## Phase 1: Newsroom API + Content Hashing
- [ ] Create `src/app/api/v1/newsroom/segment/route.ts` — unified endpoint
- [ ] Implement SHA-256 content hash dedup
- [ ] Port `generateEvergreen()` from announce/route.ts
- [ ] Port `generateWeather()` from weather/route.ts
- [ ] Port `generateNews()` from news/route.ts
- [ ] Add `generateTransitInsight()` — reads WS server analysis
- [ ] Add `generateAlertLive()` — alert-infused facts (never cached)

## Phase 2: Redis Audio Library
- [ ] Redis sorted sets for library index per category
- [ ] `GET /api/v1/newsroom/library` — browse cached segments
- [ ] Library stats for debugging

## Phase 3: Transit Analysis Integration
- [ ] Fetch analysis from WS server, extract bullet points
- [ ] Rewrite as radio-style commentary
- [ ] Cache 10 min (matches analysis refresh cycle)

## Phase 4: Live Alert-Infused Segments
- [ ] Accept alerts array in request body
- [ ] Weave alert details into entertaining facts
- [ ] Enforce never-cache policy

## Phase 5: NewsroomProvider (client scheduler)
- [ ] Replace ConductorProvider with NewsroomProvider
- [ ] Playlist scheduler with 10:1 ratio
- [ ] Pre-fetch next segments for gapless playback
- [ ] Alert interrupt subscription
- [ ] Recency buffer (no repeat within 20 plays)

## Phase 6: Cleanup
- [ ] Delete old conductor routes (announce, news, weather)
- [ ] Delete ConductorProvider
- [ ] Update layout.tsx imports
- [ ] Move constants.ts to newsroom
