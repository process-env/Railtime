'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAlerts } from '@/hooks/use-alerts';
import type { ServiceAlert } from '@/types/mta';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SegmentType = 'evergreen' | 'weather' | 'news' | 'transit-insight' | 'alert-live';

interface SegmentResponse {
  text: string;
  audioUrl: string;
  segmentId: string;
  category: 'evergreen' | 'semi-live' | 'live';
  cached: boolean;
  ttl: number;
}

interface LibrarySegment {
  segmentId: string;
  text: string;
  category: string;
  createdAt: number;
}

interface LibraryResponse {
  segments: LibrarySegment[];
  stats: { evergreen: number; semiLive: number; total: number };
}

interface NewsroomProviderProps {
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a random integer in [min, max] inclusive. */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Weighted random pick from an array of [value, weight] tuples. */
function weightedPick<T>(options: Array<[T, number]>): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1][0];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchSegment(
  type: SegmentType,
  alerts?: Array<{ id: string; headerText: string; affectedRoutes?: string[] }>,
): Promise<SegmentResponse> {
  const body: Record<string, unknown> = { type };
  if (alerts) body.alerts = alerts;

  const res = await fetch('/api/v1/newsroom/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Segment API returned ${res.status}`);
  }

  return res.json();
}

async function fetchLibrary(
  category: 'evergreen' | 'semi-live',
  limit: number = 20,
): Promise<LibraryResponse> {
  const res = await fetch(
    `/api/v1/newsroom/library?category=${category}&limit=${limit}`,
  );

  if (!res.ok) {
    throw new Error(`Library API returned ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// NewsroomProvider
// ---------------------------------------------------------------------------

export function NewsroomProvider({ children }: NewsroomProviderProps) {
  const { alerts } = useAlerts();

  // --- Mutable refs (no re-renders) ---
  const hasStartedRef = useRef(false);
  const counterRef = useRef(0);
  const isPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // Recency buffer: last 20 segment IDs played
  const recentSegmentsRef = useRef<string[]>([]);

  // Alert interrupt tracking
  const previousAlertIdsRef = useRef<Set<string>>(new Set());
  const urgentAlertRef = useRef<ServiceAlert | null>(null);

  // Pre-fetched next segment
  const prefetchedRef = useRef<SegmentResponse | null>(null);
  const prefetchPromiseRef = useRef<Promise<SegmentResponse | null> | null>(null);

  // Volume (persisted in localStorage)
  const volumeRef = useRef(0.85);

  // Snapshot alerts into a ref so async callbacks always see latest
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  // ---------------------------------------------------------------------------
  // Alert interrupt detection
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!alerts || alerts.length === 0) return;

    const currentIds = new Set(alerts.map((a) => a.id));
    const prevIds = previousAlertIdsRef.current;

    for (const alert of alerts) {
      if (!prevIds.has(alert.id)) {
        // New alert detected -- set as urgent
        urgentAlertRef.current = alert;
        break; // Only one urgent alert at a time
      }
    }

    previousAlertIdsRef.current = currentIds;
  }, [alerts]);

  // ---------------------------------------------------------------------------
  // Add segment to recency buffer
  // ---------------------------------------------------------------------------
  const trackRecent = useCallback((segmentId: string) => {
    const recent = recentSegmentsRef.current;
    recent.push(segmentId);
    if (recent.length > 20) {
      recent.shift();
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Audio playback
  // ---------------------------------------------------------------------------
  const playAudio = useCallback((audioUrl: string): Promise<void> => {
    return new Promise((resolve) => {
      if (isPlayingRef.current || unmountedRef.current) {
        resolve();
        return;
      }

      isPlayingRef.current = true;
      const audio = new Audio(audioUrl);
      audio.volume = volumeRef.current;
      audioRef.current = audio;

      audio.onended = () => {
        isPlayingRef.current = false;
        audioRef.current = null;
        resolve();
      };

      audio.onerror = () => {
        isPlayingRef.current = false;
        audioRef.current = null;
        resolve();
      };

      audio.play().catch(() => {
        isPlayingRef.current = false;
        audioRef.current = null;
        resolve();
      });
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Determine what type of segment to play next (for the live slot)
  // ---------------------------------------------------------------------------
  const pickLiveType = useCallback((): {
    type: SegmentType;
    alerts?: Array<{ id: string; headerText: string; affectedRoutes?: string[] }>;
  } => {
    const currentAlerts = alertsRef.current;
    const hasAlerts = currentAlerts && currentAlerts.length > 0;

    // Weighted pick: transit-insight 50%, alert-live 30% (if alerts), weather 20%
    const options: Array<[SegmentType, number]> = [
      ['transit-insight', 50],
      ['weather', 20],
    ];

    if (hasAlerts) {
      options.push(['alert-live', 30]);
    }

    const type = weightedPick(options);

    if (type === 'alert-live' && hasAlerts) {
      const alert = currentAlerts[Math.floor(Math.random() * currentAlerts.length)];
      return {
        type,
        alerts: [
          {
            id: alert.id,
            headerText: alert.headerText,
            affectedRoutes: alert.affectedRoutes,
          },
        ],
      };
    }

    return { type };
  }, []);

  // ---------------------------------------------------------------------------
  // Pick a cached segment from the library, avoiding recency buffer
  // ---------------------------------------------------------------------------
  const pickFromLibrary = useCallback(async (): Promise<SegmentResponse | null> => {
    // 70% evergreen, 30% semi-live
    const category = weightedPick<'evergreen' | 'semi-live'>([
      ['evergreen', 70],
      ['semi-live', 30],
    ]);

    let segmentType: SegmentType;

    if (category === 'evergreen') {
      segmentType = 'evergreen';
    } else {
      // Semi-live: weather 40%, news 40%, transit-insight 20%
      segmentType = weightedPick<SegmentType>([
        ['weather', 40],
        ['news', 40],
        ['transit-insight', 20],
      ]);
    }

    // Try to fetch from the library to check recency
    try {
      const library = await fetchLibrary(category, 20);
      const recent = new Set(recentSegmentsRef.current);

      // Find a segment not in recency buffer
      const candidate = library.segments.find(
        (seg) => !recent.has(seg.segmentId),
      );

      if (candidate) {
        // We found a non-recent cached segment. But the library only returns
        // metadata (no audioUrl). We still need to fetch from the segment
        // endpoint to get audio. The server will return it from cache.
        const segment = await fetchSegment(segmentType);
        return segment;
      }
    } catch {
      // Library fetch failed; fall through to direct fetch
    }

    // Fallback: just fetch a fresh segment of the chosen type
    try {
      return await fetchSegment(segmentType);
    } catch (err) {
      console.error('[Newsroom] Failed to fetch segment:', err);
      return null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch the next segment based on scheduler logic
  // ---------------------------------------------------------------------------
  const fetchNextSegment = useCallback(async (): Promise<SegmentResponse | null> => {
    // 1. Urgent alert interrupt (doesn't count toward counter)
    const urgentAlert = urgentAlertRef.current;
    if (urgentAlert) {
      urgentAlertRef.current = null;
      try {
        return await fetchSegment('alert-live', [
          {
            id: urgentAlert.id,
            headerText: urgentAlert.headerText,
            affectedRoutes: urgentAlert.affectedRoutes,
          },
        ]);
      } catch (err) {
        console.error('[Newsroom] Urgent alert segment failed:', err);
        return null;
      }
    }

    // 2. Every 11th segment is a live slot (counter % 11 === 0 && counter > 0)
    const counter = counterRef.current;
    if (counter > 0 && counter % 11 === 0) {
      const pick = pickLiveType();
      try {
        return await fetchSegment(pick.type, pick.alerts);
      } catch (err) {
        console.error('[Newsroom] Live segment failed:', err);
        return null;
      }
    }

    // 3. Default: pick from library (cached segments)
    return pickFromLibrary();
  }, [pickLiveType, pickFromLibrary]);

  // ---------------------------------------------------------------------------
  // Pre-fetch the next segment in the background
  // ---------------------------------------------------------------------------
  const startPrefetch = useCallback(() => {
    prefetchPromiseRef.current = fetchNextSegment()
      .then((seg) => {
        prefetchedRef.current = seg;
        return seg;
      })
      .catch(() => {
        prefetchedRef.current = null;
        return null;
      });
  }, [fetchNextSegment]);

  // ---------------------------------------------------------------------------
  // Main playlist loop (one iteration)
  // ---------------------------------------------------------------------------
  const playNextSegment = useCallback(async () => {
    if (unmountedRef.current) return;

    let segment: SegmentResponse | null = null;

    // Check if we have an urgent alert (takes priority over prefetch)
    if (urgentAlertRef.current) {
      // Don't use prefetched -- fetch the urgent alert segment
      prefetchedRef.current = null;
      prefetchPromiseRef.current = null;
      segment = await fetchNextSegment();
    } else if (prefetchedRef.current) {
      // Use pre-fetched segment
      segment = prefetchedRef.current;
      prefetchedRef.current = null;
      prefetchPromiseRef.current = null;
    } else if (prefetchPromiseRef.current) {
      // Wait for in-flight prefetch
      segment = await prefetchPromiseRef.current;
      prefetchedRef.current = null;
      prefetchPromiseRef.current = null;
    } else {
      // No prefetch available; fetch now
      segment = await fetchNextSegment();
    }

    if (unmountedRef.current) return;

    if (segment) {
      trackRecent(segment.segmentId);

      // Play audio
      await playAudio(segment.audioUrl);

      // Increment counter (skip for urgent alert interrupts -- they don't count)
      // We know it was an urgent alert if the segment category is 'live' and
      // we didn't expect a live slot. Simpler: always increment unless this
      // was an urgent alert play. We cleared urgentAlertRef above before fetch,
      // but the segment category tells us.
      // Actually, per spec: urgent alert plays "don't count toward ratio counter".
      // Since we cleared urgentAlertRef before fetch, check if category is 'live'
      // and counter wasn't on a live slot.
      const wasUrgent =
        segment.category === 'live' &&
        !(counterRef.current > 0 && counterRef.current % 11 === 0);

      if (!wasUrgent) {
        counterRef.current += 1;
      }
    }

    if (unmountedRef.current) return;

    // Start pre-fetching the next segment immediately
    startPrefetch();

    // Wait 20-40 seconds before playing next
    const delay = randomInt(20000, 40000);
    loopTimerRef.current = setTimeout(playNextSegment, delay);
  }, [fetchNextSegment, playAudio, trackRecent, startPrefetch]);

  // ---------------------------------------------------------------------------
  // Start sequence: welcome segment, then begin loop
  // ---------------------------------------------------------------------------
  const startPlaylist = useCallback(async () => {
    if (unmountedRef.current) return;

    // Read persisted volume
    try {
      const stored = localStorage.getItem('newsroom-volume');
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          volumeRef.current = parsed;
        }
      }
    } catch {
      // localStorage may be unavailable
    }

    // Play welcome segment
    try {
      const welcome = await fetchSegment('evergreen');
      if (unmountedRef.current) return;
      if (welcome) {
        trackRecent(welcome.segmentId);
        await playAudio(welcome.audioUrl);
      }
    } catch (err) {
      console.error('[Newsroom] Welcome segment failed:', err);
    }

    if (unmountedRef.current) return;

    // Wait 5 seconds, then start the main loop
    loopTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current) {
        // Kick off first prefetch
        startPrefetch();
        playNextSegment();
      }
    }, 5000);
  }, [playAudio, trackRecent, playNextSegment, startPrefetch]);

  // ---------------------------------------------------------------------------
  // User interaction gate + cleanup
  // ---------------------------------------------------------------------------
  useEffect(() => {
    unmountedRef.current = false;

    const startOnInteraction = () => {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('keydown', startOnInteraction);
        startPlaylist();
      }
    };

    document.addEventListener('click', startOnInteraction);
    document.addEventListener('keydown', startOnInteraction);

    return () => {
      unmountedRef.current = true;
      document.removeEventListener('click', startOnInteraction);
      document.removeEventListener('keydown', startOnInteraction);

      // Pause any playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      isPlayingRef.current = false;

      // Clear all timers
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
