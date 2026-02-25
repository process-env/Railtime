# Code Review: Session 2026-02-25

Last Updated: 2026-02-25

## Executive Summary

**Assessment: Ship with minor follow-ups.**

Four targeted, well-motivated changes that improve resilience and UX. The trains API stale-fallback strategy is the most impactful change — it prevents total data loss during MTA outages. The NewsroomProvider audio improvements fix real-world playback issues with data: URLs. The RouteFilter grid change is clean CSS. The `maxDuration` export is a necessary Vercel config fix.

The main risk area is the trains route test suite, which is now out of date and will give false confidence. Two medium-priority correctness issues exist in the NewsroomProvider.

---

## Strengths

1. **Stale fallback pattern is well-designed** (`route.ts:trains`). The dual-key strategy (`feed:ACE:positions` at 20s + `feed:ACE:positions:stale` at 120s) gives a 2-minute safety net without polluting the primary cache. The `source` field in the response (`mta`, `cache`, `partial-cache`, `partial-stale`, `stale`) provides excellent observability for debugging.

2. **Blob URL conversion is correct** (`NewsroomProvider.tsx:36-46`). Converting base64 data: URLs to blob: URLs avoids the Chrome/Safari issue where `new Audio(dataUrl)` silently fails for payloads >1MB. The `settle()` pattern ensures cleanup in all code paths.

3. **Cleanup is thorough** (`NewsroomProvider.tsx:430-449`). The unmount handler revokes blob URLs before pausing audio — correct order to prevent the browser from re-requesting a revoked URL.

4. **Retry with backoff** (`NewsroomProvider.tsx:109-115`). Single retry with 2s delay is pragmatic for a non-critical segment fetch. Doesn't retry indefinitely.

5. **Grid layout for RouteFilter** (`RouteFilter.tsx:111`). `grid-cols-6` with `justify-items-center` ensures consistent alignment for 25 buttons across 5 rows. Much better than `flex-wrap` for fixed-count layouts.

---

## Issues & Findings

### Correctness / Bugs

#### C1: `updatedAt` is misleading for stale responses (Medium)
**File**: `src/app/api/v1/trains/route.ts:129`

When returning stale fallback data, `updatedAt` is set to `new Date().toISOString()` — the current time. But the data could be up to 2 minutes old. Consumers relying on `updatedAt` to show "last updated" will display incorrect freshness.

```typescript
// Current (misleading):
{ trains: stale, updatedAt: new Date().toISOString(), source: 'stale' }

// Better: include a staleSince or indicate the data age
```

**Recommendation**: Either (a) store the original timestamp with the stale cache entry and return it, or (b) accept this as a known limitation since `source: 'stale'` already signals the data isn't fresh.

#### C2: `dataUrlToBlobUrl` assumes single comma in data URL (Low)
**File**: `src/components/newsroom/NewsroomProvider.tsx:37`

```typescript
const [header, base64] = dataUrl.split(',');
```

If the base64 payload somehow contains a comma (unlikely for valid base64 but possible if the URL is malformed), this destructuring will truncate the data. A safer approach:

```typescript
const commaIndex = dataUrl.indexOf(',');
const header = dataUrl.substring(0, commaIndex);
const base64 = dataUrl.substring(commaIndex + 1);
```

**Risk**: Very low — OpenAI TTS returns well-formed base64. Defensive improvement only.

#### C3: Single-group stale fallback test is now wrong (High)
**File**: `src/app/api/v1/trains/route.test.ts:276-288`

The test "returns 500 when single-group fetchFeed throws (no catch wrapper)" asserts the old behavior. The new code wraps the single-group path in a try/catch with stale fallback, so this test should now verify that stale fallback is attempted before returning 500.

```typescript
// Old assertion (incorrect now):
expect(response.status).toBe(500);

// Should test: returns stale data when fetchFeed throws but stale cache exists
// AND: returns 500 when fetchFeed throws and no stale cache exists
```

### Design & Architecture

#### D1: Double cache write on every successful fetch (Low)
**File**: `src/app/api/v1/trains/route.ts:67-68`

Every successful fetch writes to both `feed:ACE:positions` (20s TTL) and `feed:ACE:positions:stale` (120s TTL). This doubles Redis write volume. Since these are fire-and-forget `.catch(() => {})`, the latency impact is minimal, but it doubles the write ops.

**Mitigation**: This is acceptable. The writes are small (~5-50KB per group), fire-and-forget, and the stale key only matters during outages. The simplicity outweighs a more complex "write stale only when about to expire" approach.

#### D2: `failedGroups` mutation inside `Promise.all` callback (Medium)
**File**: `src/app/api/v1/trains/route.ts:156`

```typescript
const failedGroups: string[] = [];
// Inside Promise.all map:
failedGroups.push(gid);
```

Mutating an outer array from inside concurrent `.catch()` callbacks is technically safe in JS (single-threaded), but it's a code smell. It also makes the intent harder to follow.

**Alternative**: Return a discriminated result from each promise:
```typescript
type FetchResult = { ok: true; entities: FeedEntity[] } | { ok: false; groupId: string };
```

This is a stylistic preference — the current code works correctly.

### Maintainability & Readability

#### M1: Magic string `:stale` suffix (Low)
**File**: `src/app/api/v1/trains/route.ts:68, 81, 125, 171`

The `:stale` cache key suffix appears 4 times as inline string concatenation. If this pattern expands, a helper like `staleCacheKey(groupId)` would reduce typo risk.

#### M2: Nested `doFetch` inside `fetchSegment` (Low)
**File**: `src/components/newsroom/NewsroomProvider.tsx:95-107`

The retry pattern defines `doFetch` as an inner function, then calls it twice. This is clear enough for one retry, but could be extracted to a generic `retryOnce(fn, delayMs)` utility if the pattern appears elsewhere.

### Performance & Scalability

#### P1: Stale fallback adds latency on the failure path (Low)
**File**: `src/app/api/v1/trains/route.ts:125, 170-177`

When MTA fetches fail, the stale fallback path adds sequential Redis reads. In the all-groups path, if all 8 groups fail, that's 8 additional `getCache` calls. Since MTA failures typically take the full timeout (15s) to resolve, the extra Redis reads (~1-5ms each) are negligible.

### Security & Privacy

No security concerns. All changes are to internal APIs with rate limiting. No new user input surfaces.

### DX / API Ergonomics

#### DX1: `source` field values growing (Low)
The trains API `source` field now has 5 possible values: `mta`, `cache`, `partial-cache`, `partial-stale`, `stale`. These should be documented (at minimum as a TypeScript union type in the response type). Consumers need to know what to expect.

---

## Recommendations (Prioritized)

1. **[High] Update trains route tests** — Fix the test at line 276 and add new tests for stale fallback behavior. The existing test suite will pass but gives false confidence. See task T1.

2. **[Medium] Consider returning original timestamp for stale data** — Either store the creation timestamp in the stale cache entry, or document that `updatedAt` is request time, not data time. See C1.

3. **[Low] Add TypeScript union type for `source` field** — Helps API consumers. Could be as simple as:
   ```typescript
   type TrainSource = 'mta' | 'cache' | 'partial-cache' | 'partial-stale' | 'stale';
   ```

4. **[Low] Extract stale cache key helper** — Reduces magic string risk if the pattern grows.

---

## Testing & Coverage

### Current State

| File | Test File | Status |
|------|-----------|--------|
| `trains/route.ts` | `route.test.ts` (20 tests) | **Out of date** — missing stale fallback tests |
| `RouteFilter.tsx` | `RouteFilter.test.tsx` (9 tests) | OK — grid change is visual, existing assertions still pass |
| `NewsroomProvider.tsx` | None | No test coverage |
| `newsroom/segment/route.ts` | None | No test coverage |

### Missing Test Cases (Trains Route)

1. **Single-group: MTA fails, stale cache exists** → should return stale data with `source: 'stale'`
2. **Single-group: MTA fails, no stale cache** → should return 500
3. **All-groups: some groups fail, stale exists for failed** → should merge `cached + fresh + stale`
4. **All-groups: some groups fail, no stale exists** → should return without failed groups
5. **Source field: `partial-stale`** → verify source when stale fallback is used in all-groups path
6. **Stale cache write** → verify `setCache` called with `:stale` key and 120s TTL

### Missing Test Cases (NewsroomProvider)

Given the complexity (audio playback, timers, DOM events), integration testing is expensive. Recommended unit tests for extracted helpers:

1. **`dataUrlToBlobUrl`** — valid data URL conversion, edge cases
2. **`fetchSegment` retry** — first call fails, retry succeeds; both calls fail
3. **`getNextScheduledEvent`** — schedule alignment at various clock times

---

## Consistency with Standards

| Standard | Status |
|----------|--------|
| TypeScript strict mode | OK — all files compile |
| Existing patterns | OK — follows established cache/error patterns |
| Fire-and-forget cache writes | OK — `.catch(() => {})` matches existing pattern |
| `console.warn` for degraded paths | OK — consistent with existing logging |
| `useCallback` for stable refs | OK — `playAudio`, `trackRecent` properly memoized |
| Blob URL revocation | OK — revoked in both `settle()` and cleanup effect |

---

## Overall Assessment

These are 4 well-scoped, well-implemented changes. The stale fallback strategy is the right call for resilience against MTA outages. The audio improvements fix real playback issues. The grid layout is cleaner.

**Ship now, but update the test suite promptly.** The stale fallback test gap (C3) is the only item that should be addressed before the next feature work on the trains API.
