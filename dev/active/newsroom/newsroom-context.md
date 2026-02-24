# Unified Newsroom — Context
Last Updated: 2026-02-24

## What
Replacing the 3 separate conductor audio endpoints (announce, news, weather) with a unified "1010 WINS"-style newsroom that mixes cached evergreen audio with live-generated segments incorporating transit analysis and alerts.

## Why
- Current system makes 2 OpenAI API calls per segment (chat + TTS) with minimal caching
- News and weather endpoints have zero caching — identical content regenerated every time
- No integration with AI transit analysis (GPT-4.1 insights from WS server)
- No way to infuse live alerts into entertaining content
- Audio library doesn't grow over time — same facts repeat

## Architecture
- Single endpoint: `POST /api/v1/newsroom/segment`
- Content hash dedup: SHA-256 of text → Redis key → skip TTS if audio exists
- 3 categories: Evergreen (7d), Semi-live (10-30min), Live (never cached)
- Client-side NewsroomProvider with playlist scheduler enforcing 10:1 cached:live ratio
- Alert interrupts force live segment regardless of ratio counter

## Dependencies
- OpenAI GPT-4.1-mini (text generation) — via `CONDUCTOR_CHAT_MODEL` constant
- OpenAI TTS-1 (audio synthesis) — voices: fable (default), nova (news), echo (weather)
- Redis (audio cache + library index)
- WS server transit analysis endpoint (`/api/transit-analysis`)
- Open-Meteo API (weather, no key needed)
- NYTimes + Gothamist RSS feeds (news)
- `public/data/subway-facts.json` (evergreen facts)

## Related Files
- Current conductor: `src/app/api/v1/conductor/{announce,news,weather}/route.ts`
- ConductorProvider: `src/components/conductor/ConductorProvider.tsx`
- Transit analysis hook: `src/hooks/use-transit-analysis.ts`
- Alerts hook: `src/hooks/use-alerts.ts`
- Redis utilities: `src/lib/redis.ts`
- Rate limiting: `src/lib/api/rate-limit.ts`
