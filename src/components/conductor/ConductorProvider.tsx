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
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasStartedRef = useRef(false);
  const trainsRef = useRef(trains);
  const stationsRef = useRef(stations);

  // Keep refs in sync
  useEffect(() => {
    trainsRef.current = trains;
    stationsRef.current = stations;
  }, [trains, stations]);

  const playAndSchedule = async (type: string) => {
    const currentTrains = trainsRef.current;
    const currentStations = stationsRef.current;

    if (currentTrains.length === 0) {
      timerRef.current = setTimeout(() => playAndSchedule(type), 2000);
      return;
    }

    setIsPlaying(true);
    setStatus('Generating...');

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
      setStatus(data.text);

      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.volume = 0.8;
        audioRef.current = audio;

        audio.onended = () => {
          setIsPlaying(false);
          const delay = 15000 + Math.random() * 30000;
          timerRef.current = setTimeout(() => playAndSchedule('fun_fact'), delay);
        };

        audio.onerror = () => {
          setIsPlaying(false);
          const delay = 15000 + Math.random() * 30000;
          timerRef.current = setTimeout(() => playAndSchedule('fun_fact'), delay);
        };

        await audio.play();
      } else {
        setIsPlaying(false);
        const delay = 15000 + Math.random() * 30000;
        timerRef.current = setTimeout(() => playAndSchedule('fun_fact'), delay);
      }
    } catch (error) {
      console.error(error);
      setIsPlaying(false);
      const delay = 15000 + Math.random() * 30000;
      timerRef.current = setTimeout(() => playAndSchedule('fun_fact'), delay);
    }
  };

  // Wait for first user interaction, then start
  useEffect(() => {
    const startOnInteraction = () => {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        playAndSchedule('welcome');
        // Remove listeners after first interaction
        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('keydown', startOnInteraction);
      }
    };

    document.addEventListener('click', startOnInteraction);
    document.addEventListener('keydown', startOnInteraction);

    return () => {
      document.removeEventListener('click', startOnInteraction);
      document.removeEventListener('keydown', startOnInteraction);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  return <>{children}</>;
}
