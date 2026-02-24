'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAlerts } from '@/hooks/use-alerts';
import type { ServiceAlert } from '@/types/mta';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SegmentType = 'evergreen' | 'weather' | 'news' | 'transit-insight' | 'alert-live' | 'news-block';

interface SegmentResponse {
  text: string;
  audioUrl: string;
  segmentId: string;
  category: 'evergreen' | 'semi-live' | 'live';
  cached: boolean;
  ttl: number;
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

// ---------------------------------------------------------------------------
// Clock-aligned broadcast schedule
// ---------------------------------------------------------------------------

const SCHEDULE = {
  news: [0, 10, 20, 30, 40, 50],   // minutes of the hour
  weather: [59],                      // minute 59
} as const;

function getNextScheduledEvent(): { type: 'news-block' | 'weather'; fireAt: Date } {
  const now = new Date();
  const minute = now.getMinutes();
  const second = now.getSeconds();

  // Build sorted list of all scheduled events
  const allScheduled = [
    ...SCHEDULE.news.map((m) => ({ type: 'news-block' as const, minute: m })),
    ...SCHEDULE.weather.map((m) => ({ type: 'weather' as const, minute: m })),
  ].sort((a, b) => a.minute - b.minute);

  // Find the next event that hasn't passed yet this hour
  for (const event of allScheduled) {
    if (event.minute > minute || (event.minute === minute && second < 30)) {
      const fireAt = new Date(now);
      fireAt.setMinutes(event.minute, 0, 0);
      return { type: event.type, fireAt };
    }
  }

  // Wrap to next hour's first event
  const first = allScheduled[0];
  const fireAt = new Date(now);
  fireAt.setHours(fireAt.getHours() + 1, first.minute, 0, 0);
  return { type: first.type, fireAt };
}

// ---------------------------------------------------------------------------
// API helper
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

// ---------------------------------------------------------------------------
// NewsroomProvider
// ---------------------------------------------------------------------------

export function NewsroomProvider({ children }: NewsroomProviderProps) {
  const { alerts } = useAlerts();

  // --- Mutable refs (no re-renders) ---
  const hasStartedRef = useRef(false);
  const isPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // Recency buffer: last 20 segment IDs played
  const recentSegmentsRef = useRef<string[]>([]);

  // Alert interrupt tracking
  const previousAlertIdsRef = useRef<Set<string>>(new Set());
  const urgentAlertRef = useRef<ServiceAlert | null>(null);

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
  // Main schedule loop
  // ---------------------------------------------------------------------------
  const scheduleNextEvent = useCallback(async () => {
    if (unmountedRef.current) return;

    // 1. Check for urgent alert interrupt
    const urgentAlert = urgentAlertRef.current;
    if (urgentAlert) {
      urgentAlertRef.current = null;
      try {
        const segment = await fetchSegment('alert-live', [
          {
            id: urgentAlert.id,
            headerText: urgentAlert.headerText,
            affectedRoutes: urgentAlert.affectedRoutes,
          },
        ]);
        if (segment && !unmountedRef.current) {
          trackRecent(segment.segmentId);
          await playAudio(segment.audioUrl);
        }
      } catch (err) {
        console.error('[Newsroom] Urgent alert segment failed:', err);
      }
      if (unmountedRef.current) return;
      // After alert, continue with schedule
      loopTimerRef.current = setTimeout(scheduleNextEvent, 3000);
      return;
    }

    // 2. Check clock schedule
    const nextEvent = getNextScheduledEvent();
    const msUntil = nextEvent.fireAt.getTime() - Date.now();

    if (msUntil <= 30_000) {
      // Scheduled event is imminent -- wait for it, then play
      if (msUntil > 0) {
        await new Promise((resolve) => {
          loopTimerRef.current = setTimeout(resolve, msUntil);
        });
      }

      if (unmountedRef.current) return;

      // Play the scheduled segment
      try {
        let alerts: Array<{ id: string; headerText: string; affectedRoutes?: string[] }> | undefined;
        if (nextEvent.type === 'news-block' && alertsRef.current && alertsRef.current.length > 0) {
          alerts = alertsRef.current.map((a) => ({
            id: a.id,
            headerText: a.headerText,
            affectedRoutes: a.affectedRoutes,
          }));
        }
        const segment = await fetchSegment(nextEvent.type, alerts);
        if (segment && !unmountedRef.current) {
          trackRecent(segment.segmentId);
          await playAudio(segment.audioUrl);
        }
      } catch (err) {
        console.error(`[Newsroom] Scheduled ${nextEvent.type} failed:`, err);
      }

      if (unmountedRef.current) return;

      // After playing scheduled segment, continue loop
      loopTimerRef.current = setTimeout(scheduleNextEvent, 3000);
    } else {
      // Not imminent -- fill with evergreen
      try {
        const segment = await fetchSegment('evergreen');
        if (segment && !unmountedRef.current) {
          trackRecent(segment.segmentId);
          await playAudio(segment.audioUrl);
        }
      } catch (err) {
        console.error('[Newsroom] Evergreen fill failed:', err);
      }

      if (unmountedRef.current) return;

      // Wait 20-40s before next check
      const delay = randomInt(20000, 40000);
      loopTimerRef.current = setTimeout(scheduleNextEvent, delay);
    }
  }, [playAudio, trackRecent]);

  // ---------------------------------------------------------------------------
  // Start sequence: first-minute "full monty", then clock schedule
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

    // --- First-minute "full monty" sequence ---
    const fullMontyTypes: Array<{ type: SegmentType; withAlerts?: boolean }> = [
      { type: 'news-block', withAlerts: true },
      { type: 'weather' },
      { type: 'transit-insight' },
      { type: 'evergreen' },
    ];

    for (const item of fullMontyTypes) {
      if (unmountedRef.current) return;

      try {
        let alerts: Array<{ id: string; headerText: string; affectedRoutes?: string[] }> | undefined;
        if (item.withAlerts && alertsRef.current && alertsRef.current.length > 0) {
          alerts = alertsRef.current.map((a) => ({
            id: a.id,
            headerText: a.headerText,
            affectedRoutes: a.affectedRoutes,
          }));
        }
        const segment = await fetchSegment(item.type, alerts);
        if (unmountedRef.current) return;
        if (segment) {
          trackRecent(segment.segmentId);
          await playAudio(segment.audioUrl);
        }
      } catch (err) {
        console.error(`[Newsroom] Full monty ${item.type} failed:`, err);
      }

      if (unmountedRef.current) return;

      // 3-second gap between segments
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (unmountedRef.current) return;

    // Transition to clock-aligned schedule
    scheduleNextEvent();
  }, [playAudio, trackRecent, scheduleNextEvent]);

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
