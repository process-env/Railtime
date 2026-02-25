# Tasks: Session 2026-02-25

Last Updated: 2026-02-25

## Tests — Trains Route Stale Fallback

- [x] **T1: Update stale-fallback test for single-group path** — High, S
  - Fix test at `route.test.ts:276` which incorrectly expects 500 when fetchFeed throws. Now the code tries stale fallback first. Split into two tests: (a) stale exists → returns stale data, (b) no stale → returns 500. [See C3 in review]

- [x] **T2: Add stale fallback test — single-group success** — High, S
  - MTA fetchFeed throws, stale cache key returns data → response should have `source: 'stale'` and contain stale data. [See Testing section]

- [x] **T3: Add stale fallback test — all-groups partial failure** — Medium, S
  - Some groups fail in all-groups path, stale cache exists for failed groups → response should merge cached + fresh + stale with `source: 'partial-stale'`. [See Testing section]

- [x] **T4: Add stale cache write assertion** — Medium, S
  - Verify `setCache` is called with `:stale` suffix key and `STALE_FALLBACK_TTL` (120). [See Testing section]

## Correctness

- [ ] **T5: Evaluate `updatedAt` accuracy for stale responses** — Medium, M
  - Decide whether to store original creation timestamp in stale cache entry, or document that `updatedAt` is request time. Affects consumer trust in freshness indicator. [See C1 in review]

## API Types

- [x] **T6: Add TypeScript union for trains `source` field** — Low, S
  - Define `type TrainSource = 'mta' | 'cache' | 'partial-cache' | 'partial-stale' | 'stale'` and use it in the response type. [See DX1 in review]

## Code Cleanup

- [x] **T7: Extract stale cache key helper** — Low, S
  - Replace inline `\`feed:${gid}:positions:stale\`` with a `staleCacheKey(gid)` function to reduce magic string risk. [See M1 in review]

## Tests — NewsroomProvider (Future)

- [ ] **T8: Unit test `dataUrlToBlobUrl` helper** — Low, S
  - Extract to a shared utility and add tests for valid data URLs, edge cases. [See Testing section]

- [ ] **T9: Unit test `getNextScheduledEvent` schedule logic** — Low, M
  - Test clock alignment at various times: before first event, between events, after last event (wrap to next hour). [See Testing section]

- [ ] **T10: Unit test `fetchSegment` retry behavior** — Low, S
  - First call fails + retry succeeds; both calls fail. [See Testing section]
