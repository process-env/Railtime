'use client';

import { create } from 'zustand';

export type GeolocationStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';

interface GeolocationPosition {
  lat: number;
  lon: number;
}

/**
 * Module-level watch ID. This is internal plumbing for the Geolocation API,
 * not UI-relevant state, so it lives outside the Zustand store to avoid
 * unnecessary re-renders.
 */
let _watchId: number | null = null;

interface GeolocationState {
  // Position data
  position: GeolocationPosition | null;
  accuracy: number | null;
  heading: number | null;

  // Status
  status: GeolocationStatus;
  error: string | null;

  // Actions
  requestLocation: () => void;
  watchLocation: () => void;
  stopWatching: () => void;
  clearError: () => void;
}

export const useGeolocationStore = create<GeolocationState>()((set) => ({
  // Initial state
  position: null,
  accuracy: null,
  heading: null,
  status: 'idle',
  error: null,

  /**
   * Request a single location update
   */
  requestLocation: () => {
    if (!navigator.geolocation) {
      set({
        status: 'error',
        error: 'Geolocation is not supported by your browser'
      });
      return;
    }

    set({ status: 'requesting', error: null });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        set({
          position: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          },
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          status: 'active',
          error: null,
        });
      },
      (error) => {
        let errorMessage: string;
        let status: GeolocationStatus = 'error';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location access was denied';
            status = 'denied';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out';
            break;
          default:
            errorMessage = 'An unknown error occurred';
        }

        set({ status, error: errorMessage });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  },

  /**
   * Start continuous location watching
   */
  watchLocation: () => {
    if (!navigator.geolocation) {
      set({
        status: 'error',
        error: 'Geolocation is not supported by your browser'
      });
      return;
    }

    // Stop any existing watch
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
    }

    set({ status: 'requesting', error: null });

    _watchId = navigator.geolocation.watchPosition(
      (position) => {
        set({
          position: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          },
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          status: 'active',
          error: null,
        });
      },
      (error) => {
        let errorMessage: string;
        let status: GeolocationStatus = 'error';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location access was denied';
            status = 'denied';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out';
            break;
          default:
            errorMessage = 'An unknown error occurred';
        }

        set({ status, error: errorMessage });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000, // More frequent updates for watching
      }
    );
  },

  /**
   * Stop watching location
   */
  stopWatching: () => {
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
      set({ status: 'idle' });
    }
  },

  /**
   * Clear error state
   */
  clearError: () => {
    set({ error: null });
  },
}));

/**
 * Selector hook for position
 */
export function useUserPosition() {
  return useGeolocationStore((state) => state.position);
}

/**
 * Selector hook for status
 */
export function useGeolocationStatus() {
  return useGeolocationStore((state) => state.status);
}
