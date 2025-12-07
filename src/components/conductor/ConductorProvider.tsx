'use client';

import { useEffect, useRef, useState } from 'react';
import { useTrainPositions, useStaticData } from '@/hooks';

interface ConductorProviderProps {
  children: React.ReactNode;
}

export function ConductorProvider({ children }: ConductorProviderProps) {
  const { trains } = useTrainPositions({ refreshInterval: 15000 });
  const { stations } = useStaticData();
  const [status, setStatus] = useState('Click anywhere to start');
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const announcementTimerRef = useRef<NodeJS.Timeout | null>(null);
  const newsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasStartedRef = useRef(false);
  const trainsRef = useRef(trains);
  const stationsRef = useRef(stations);
  const isNewsPausedRef = useRef(false); // Pause regular announcements during news

  // Keep refs in sync
  useEffect(() => {
    trainsRef.current = trains;
    stationsRef.current = stations;
  }, [trains, stations]);

  const playAnnouncement = async (type: string) => {
    // Don't play regular announcements if news is playing
    if (isNewsPausedRef.current) return;

    const currentTrains = trainsRef.current;
    const currentStations = stationsRef.current;

    if (currentTrains.length === 0) {
      announcementTimerRef.current = setTimeout(() => playAnnouncement(type), 2000);
      return;
    }

    setIsPlaying(true);

    try {
      const randomTrain = currentTrains[Math.floor(Math.random() * currentTrains.length)];
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

      if (data.audioUrl && !isNewsPausedRef.current) {
        const audio = new Audio(data.audioUrl);
        audio.volume = 0.8;
        audioRef.current = audio;

        audio.onended = () => {
          setIsPlaying(false);
          if (!isNewsPausedRef.current) {
            const delay = 15000 + Math.random() * 30000;
            announcementTimerRef.current = setTimeout(() => playAnnouncement('fun_fact'), delay);
          }
        };

        audio.onerror = () => {
          setIsPlaying(false);
          if (!isNewsPausedRef.current) {
            const delay = 15000 + Math.random() * 30000;
            announcementTimerRef.current = setTimeout(() => playAnnouncement('fun_fact'), delay);
          }
        };

        await audio.play();
      } else {
        setIsPlaying(false);
        if (!isNewsPausedRef.current) {
          const delay = 15000 + Math.random() * 30000;
          announcementTimerRef.current = setTimeout(() => playAnnouncement('fun_fact'), delay);
        }
      }
    } catch (error) {
      console.error(error);
      setIsPlaying(false);
      if (!isNewsPausedRef.current) {
        const delay = 15000 + Math.random() * 30000;
        announcementTimerRef.current = setTimeout(() => playAnnouncement('fun_fact'), delay);
      }
    }
  };

  const playNews = async () => {
    // Pause regular announcements
    isNewsPausedRef.current = true;
    if (announcementTimerRef.current) {
      clearTimeout(announcementTimerRef.current);
    }
    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setIsPlaying(true);

    try {
      const response = await fetch('/api/v1/conductor/news');
      const data = await response.json();

      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.volume = 0.9; // Slightly louder for news
        audioRef.current = audio;

        audio.onended = () => {
          setIsPlaying(false);
          // Resume regular announcements
          isNewsPausedRef.current = false;
          const delay = 5000 + Math.random() * 10000; // Resume after 5-15 sec
          announcementTimerRef.current = setTimeout(() => playAnnouncement('fun_fact'), delay);
          // Schedule next news in 10 minutes
          newsTimerRef.current = setTimeout(playNews, 10 * 60 * 1000);
        };

        audio.onerror = () => {
          setIsPlaying(false);
          isNewsPausedRef.current = false;
          announcementTimerRef.current = setTimeout(() => playAnnouncement('fun_fact'), 5000);
          newsTimerRef.current = setTimeout(playNews, 10 * 60 * 1000);
        };

        await audio.play();
      } else {
        setIsPlaying(false);
        isNewsPausedRef.current = false;
        newsTimerRef.current = setTimeout(playNews, 10 * 60 * 1000);
      }
    } catch (error) {
      console.error('News error:', error);
      setIsPlaying(false);
      isNewsPausedRef.current = false;
      newsTimerRef.current = setTimeout(playNews, 10 * 60 * 1000);
    }
  };

  // Wait for first user interaction, then start
  useEffect(() => {
    const startOnInteraction = () => {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        // Start with welcome announcement
        playAnnouncement('welcome');
        // Schedule first news in 1 minute for quick flash, then every 10 min after
        newsTimerRef.current = setTimeout(playNews, 60 * 1000);
        // Remove listeners
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
      if (newsTimerRef.current) clearTimeout(newsTimerRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  return <>{children}</>;
}
