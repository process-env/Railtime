'use client';

import { useEffect, useRef } from 'react';
import { useTrainPositions, useStaticData } from '@/hooks';

interface ConductorProviderProps {
  children: React.ReactNode;
}

export function ConductorProvider({ children }: ConductorProviderProps) {
  const { trains } = useTrainPositions({ refreshInterval: 15000 });
  const { stations } = useStaticData();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasStartedRef = useRef(false);
  const trainsRef = useRef(trains);
  const stationsRef = useRef(stations);
  const isPlayingRef = useRef(false);
  const announcementTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    trainsRef.current = trains;
    stationsRef.current = stations;
  }, [trains, stations]);

  const playAudio = (audioUrl: string): Promise<void> => {
    return new Promise((resolve) => {
      if (isPlayingRef.current) {
        resolve();
        return;
      }
      isPlayingRef.current = true;
      const audio = new Audio(audioUrl);
      audio.volume = 0.85;
      audioRef.current = audio;
      audio.onended = () => {
        isPlayingRef.current = false;
        resolve();
      };
      audio.onerror = () => {
        isPlayingRef.current = false;
        resolve();
      };
      audio.play().catch(() => {
        isPlayingRef.current = false;
        resolve();
      });
    });
  };

  const playAnnouncement = async (type: string = 'fun_fact') => {
    if (isPlayingRef.current) return;

    const currentTrains = trainsRef.current;
    const currentStations = stationsRef.current;

    if (currentTrains.length === 0) {
      scheduleNextAnnouncement(2000);
      return;
    }

    try {
      const randomIndex = Math.floor(Math.random() * currentTrains.length);
      const randomTrain = currentTrains[randomIndex];
      const station = currentStations[randomTrain.nextStopId];
      const stationName = station?.name || randomTrain.nextStopName || 'Unknown';

      const response = await fetch('/api/v1/conductor/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId: randomTrain.routeId,
          stationName: stationName,
          announcementType: type,
        }),
      });
      const data = await response.json();
      if (data.audioUrl) {
        await playAudio(data.audioUrl);
      }
    } catch (error) {
      console.error('Announcement error:', error);
    }

    scheduleNextAnnouncement();
  };

  const playWeather = async () => {
    if (isPlayingRef.current) {
      // Wait for current audio to finish
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!isPlayingRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 500);
      });
    }

    // Clear any pending announcement
    if (announcementTimerRef.current) {
      clearTimeout(announcementTimerRef.current);
    }

    try {
      const response = await fetch('/api/v1/conductor/weather');
      const data = await response.json();
      if (data.audioUrl) {
        await playAudio(data.audioUrl);
      }
    } catch (error) {
      console.error('Weather error:', error);
    }

    scheduleNextAnnouncement(5000);
  };

  const playNews = async () => {
    if (isPlayingRef.current) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!isPlayingRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 500);
      });
    }

    if (announcementTimerRef.current) {
      clearTimeout(announcementTimerRef.current);
    }

    try {
      const response = await fetch('/api/v1/conductor/news');
      const data = await response.json();
      if (data.audioUrl) {
        await playAudio(data.audioUrl);
      }
    } catch (error) {
      console.error('News error:', error);
    }

    scheduleNextAnnouncement(5000);
  };

  const scheduleNextAnnouncement = (delay?: number) => {
    if (announcementTimerRef.current) {
      clearTimeout(announcementTimerRef.current);
    }
    const wait = delay ?? (15000 + Math.random() * 30000);
    announcementTimerRef.current = setTimeout(() => {
      playAnnouncement('fun_fact');
    }, wait);
  };

  useEffect(() => {
    const startOnInteraction = () => {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;

        // Timeline:
        // 0s - Welcome
        // 30s - Weather (once)
        // 80s - News (once)
        // Then: announcements every 15-45s, weather top of hour, news every 10 min

        playAnnouncement('welcome');

        // Weather at 30s
        setTimeout(playWeather, 30 * 1000);

        // News at 1:20
        setTimeout(playNews, 80 * 1000);

        // Schedule recurring weather (top of hour)
        const scheduleHourlyWeather = () => {
          const now = new Date();
          const nextHour = new Date(now);
          nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
          const msUntilNextHour = nextHour.getTime() - now.getTime();
          setTimeout(() => {
            playWeather();
            scheduleHourlyWeather();
          }, msUntilNextHour);
        };
        scheduleHourlyWeather();

        // Schedule recurring news (every 10 min after initial)
        setInterval(playNews, 10 * 60 * 1000);

        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('keydown', startOnInteraction);
      }
    };

    document.addEventListener('click', startOnInteraction);
    document.addEventListener('keydown', startOnInteraction);

    return () => {
      document.removeEventListener('click', startOnInteraction);
      document.removeEventListener('keydown', startOnInteraction);
      if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
