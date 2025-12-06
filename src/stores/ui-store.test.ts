import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';

describe('useUIStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useUIStore.setState({
      theme: 'system',
      sidebarOpen: true,
      selectedStationId: null,
      selectedTrainId: null,
      selectedRouteIds: [],
      mapCenter: [-73.9857, 40.7484],
      mapZoom: 12,
    });
  });

  describe('initial state', () => {
    it('has system theme', () => {
      expect(useUIStore.getState().theme).toBe('system');
    });

    it('has sidebar open', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('has no selected station', () => {
      expect(useUIStore.getState().selectedStationId).toBeNull();
    });

    it('has no selected train', () => {
      expect(useUIStore.getState().selectedTrainId).toBeNull();
    });

    it('has empty route filters', () => {
      expect(useUIStore.getState().selectedRouteIds).toEqual([]);
    });

    it('has default NYC map center', () => {
      const { mapCenter } = useUIStore.getState();
      expect(mapCenter[0]).toBeCloseTo(-73.9857);
      expect(mapCenter[1]).toBeCloseTo(40.7484);
    });

    it('has default zoom level 12', () => {
      expect(useUIStore.getState().mapZoom).toBe(12);
    });
  });

  describe('setTheme', () => {
    it('sets theme to light', () => {
      useUIStore.getState().setTheme('light');
      expect(useUIStore.getState().theme).toBe('light');
    });

    it('sets theme to dark', () => {
      useUIStore.getState().setTheme('dark');
      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('sets theme to system', () => {
      useUIStore.setState({ theme: 'dark' });
      useUIStore.getState().setTheme('system');
      expect(useUIStore.getState().theme).toBe('system');
    });
  });

  describe('setSidebarOpen', () => {
    it('opens sidebar', () => {
      useUIStore.setState({ sidebarOpen: false });
      useUIStore.getState().setSidebarOpen(true);
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('closes sidebar', () => {
      useUIStore.getState().setSidebarOpen(false);
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('toggleSidebar', () => {
    it('closes open sidebar', () => {
      useUIStore.setState({ sidebarOpen: true });
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });

    it('opens closed sidebar', () => {
      useUIStore.setState({ sidebarOpen: false });
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('toggles multiple times', () => {
      useUIStore.setState({ sidebarOpen: true });
      useUIStore.getState().toggleSidebar();
      useUIStore.getState().toggleSidebar();
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('setSelectedStation', () => {
    it('sets station ID', () => {
      useUIStore.getState().setSelectedStation('101');
      expect(useUIStore.getState().selectedStationId).toBe('101');
    });

    it('clears station ID with null', () => {
      useUIStore.setState({ selectedStationId: '101' });
      useUIStore.getState().setSelectedStation(null);
      expect(useUIStore.getState().selectedStationId).toBeNull();
    });

    it('replaces previous selection', () => {
      useUIStore.getState().setSelectedStation('101');
      useUIStore.getState().setSelectedStation('102');
      expect(useUIStore.getState().selectedStationId).toBe('102');
    });
  });

  describe('setSelectedTrain', () => {
    it('sets train ID', () => {
      useUIStore.getState().setSelectedTrain('trip123');
      expect(useUIStore.getState().selectedTrainId).toBe('trip123');
    });

    it('clears train ID with null', () => {
      useUIStore.setState({ selectedTrainId: 'trip123' });
      useUIStore.getState().setSelectedTrain(null);
      expect(useUIStore.getState().selectedTrainId).toBeNull();
    });

    it('replaces previous selection', () => {
      useUIStore.getState().setSelectedTrain('trip1');
      useUIStore.getState().setSelectedTrain('trip2');
      expect(useUIStore.getState().selectedTrainId).toBe('trip2');
    });
  });

  describe('toggleRouteFilter', () => {
    it('adds route to filters', () => {
      useUIStore.getState().toggleRouteFilter('A');
      expect(useUIStore.getState().selectedRouteIds).toContain('A');
    });

    it('removes route from filters', () => {
      useUIStore.setState({ selectedRouteIds: ['A', 'B', 'C'] });
      useUIStore.getState().toggleRouteFilter('B');
      expect(useUIStore.getState().selectedRouteIds).toEqual(['A', 'C']);
    });

    it('adds multiple routes', () => {
      useUIStore.getState().toggleRouteFilter('A');
      useUIStore.getState().toggleRouteFilter('B');
      useUIStore.getState().toggleRouteFilter('C');
      expect(useUIStore.getState().selectedRouteIds).toEqual(['A', 'B', 'C']);
    });

    it('toggles same route on and off', () => {
      useUIStore.getState().toggleRouteFilter('A');
      expect(useUIStore.getState().selectedRouteIds).toContain('A');

      useUIStore.getState().toggleRouteFilter('A');
      expect(useUIStore.getState().selectedRouteIds).not.toContain('A');
    });
  });

  describe('setRouteFilters', () => {
    it('sets multiple routes at once', () => {
      useUIStore.getState().setRouteFilters(['A', 'C', 'E']);
      expect(useUIStore.getState().selectedRouteIds).toEqual(['A', 'C', 'E']);
    });

    it('replaces existing filters', () => {
      useUIStore.setState({ selectedRouteIds: ['A', 'B'] });
      useUIStore.getState().setRouteFilters(['1', '2', '3']);
      expect(useUIStore.getState().selectedRouteIds).toEqual(['1', '2', '3']);
    });

    it('sets empty array', () => {
      useUIStore.setState({ selectedRouteIds: ['A', 'B'] });
      useUIStore.getState().setRouteFilters([]);
      expect(useUIStore.getState().selectedRouteIds).toEqual([]);
    });
  });

  describe('clearRouteFilters', () => {
    it('clears all route filters', () => {
      useUIStore.setState({ selectedRouteIds: ['A', 'B', 'C', '1', '2', '3'] });
      useUIStore.getState().clearRouteFilters();
      expect(useUIStore.getState().selectedRouteIds).toEqual([]);
    });

    it('works when already empty', () => {
      useUIStore.getState().clearRouteFilters();
      expect(useUIStore.getState().selectedRouteIds).toEqual([]);
    });
  });

  describe('setMapView', () => {
    it('sets center and zoom', () => {
      useUIStore.getState().setMapView([-74.0, 40.8], 15);
      const { mapCenter, mapZoom } = useUIStore.getState();
      expect(mapCenter).toEqual([-74.0, 40.8]);
      expect(mapZoom).toBe(15);
    });

    it('updates both values atomically', () => {
      useUIStore.getState().setMapView([-73.5, 40.6], 10);
      const state = useUIStore.getState();
      expect(state.mapCenter[0]).toBe(-73.5);
      expect(state.mapCenter[1]).toBe(40.6);
      expect(state.mapZoom).toBe(10);
    });

    it('handles extreme zoom values', () => {
      useUIStore.getState().setMapView([-73.9857, 40.7484], 1);
      expect(useUIStore.getState().mapZoom).toBe(1);

      useUIStore.getState().setMapView([-73.9857, 40.7484], 22);
      expect(useUIStore.getState().mapZoom).toBe(22);
    });
  });
});
