'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  // Theme
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Selected entities
  selectedStationId: string | null;
  setSelectedStation: (stationId: string | null) => void;

  selectedTrainId: string | null;
  setSelectedTrain: (tripId: string | null) => void;

  selectedRouteIds: string[];
  toggleRouteFilter: (routeId: string) => void;
  setRouteFilters: (routeIds: string[]) => void;
  clearRouteFilters: () => void;

  // Map viewport
  mapCenter: [number, number];
  mapZoom: number;
  setMapView: (center: [number, number], zoom: number) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Theme
      theme: 'system',
      setTheme: (theme) => set({ theme }),

      // Sidebar
      sidebarOpen: true,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      // Selected entities
      selectedStationId: null,
      setSelectedStation: (selectedStationId) => set({ selectedStationId }),

      selectedTrainId: null,
      setSelectedTrain: (selectedTrainId) => set({ selectedTrainId }),

      selectedRouteIds: [],
      toggleRouteFilter: (routeId) =>
        set((state) => ({
          selectedRouteIds: state.selectedRouteIds.includes(routeId)
            ? state.selectedRouteIds.filter((id) => id !== routeId)
            : [...state.selectedRouteIds, routeId],
        })),
      setRouteFilters: (selectedRouteIds) => set({ selectedRouteIds }),
      clearRouteFilters: () => set({ selectedRouteIds: [] }),

      // Map viewport - NYC center
      mapCenter: [-73.9857, 40.7484],
      mapZoom: 12,
      setMapView: (mapCenter, mapZoom) => set({ mapCenter, mapZoom }),
    }),
    {
      name: 'mta-ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
