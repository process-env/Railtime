import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useGeolocationStore } from './geolocation-store';

/**
 * Mock navigator.geolocation
 */
function createMockGeolocation() {
  const watchCallbacks: {
    success: PositionCallback;
    error: PositionErrorCallback;
  }[] = [];

  let nextWatchId = 1;

  const mock = {
    getCurrentPosition: vi.fn(
      (success: PositionCallback, error?: PositionErrorCallback | null) => {
        mock._currentSuccess = success;
        mock._currentError = error ?? undefined;
      }
    ),
    watchPosition: vi.fn(
      (success: PositionCallback, error?: PositionErrorCallback | null) => {
        const id = nextWatchId++;
        watchCallbacks.push({
          success,
          error: error ?? (() => {}),
        });
        return id;
      }
    ),
    clearWatch: vi.fn(),
    _currentSuccess: undefined as PositionCallback | undefined,
    _currentError: undefined as PositionErrorCallback | undefined,
    _watchCallbacks: watchCallbacks,
  };

  return mock;
}

function createMockPosition(lat: number, lon: number, accuracy = 10): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() { return this; },
    },
    timestamp: Date.now(),
    toJSON() { return this; },
  };
}

function createMockPositionError(code: number, message = 'Error'): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

describe('useGeolocationStore', () => {
  let mockGeo: ReturnType<typeof createMockGeolocation>;

  beforeEach(() => {
    // Reset store state
    useGeolocationStore.setState({
      position: null,
      accuracy: null,
      heading: null,
      status: 'idle',
      error: null,
    });

    // Set up geolocation mock
    mockGeo = createMockGeolocation();
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: mockGeo,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('has null position and idle status', () => {
      const state = useGeolocationStore.getState();
      expect(state.position).toBeNull();
      expect(state.accuracy).toBeNull();
      expect(state.heading).toBeNull();
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
    });
  });

  describe('requestLocation', () => {
    it('sets status to requesting', () => {
      useGeolocationStore.getState().requestLocation();
      expect(useGeolocationStore.getState().status).toBe('requesting');
    });

    it('calls getCurrentPosition', () => {
      useGeolocationStore.getState().requestLocation();
      expect(mockGeo.getCurrentPosition).toHaveBeenCalledOnce();
    });

    it('updates position on success', () => {
      useGeolocationStore.getState().requestLocation();

      const mockPos = createMockPosition(40.7128, -74.006, 15);
      mockGeo._currentSuccess!(mockPos);

      const state = useGeolocationStore.getState();
      expect(state.position).toEqual({ lat: 40.7128, lon: -74.006 });
      expect(state.accuracy).toBe(15);
      expect(state.status).toBe('active');
      expect(state.error).toBeNull();
    });

    it('handles PERMISSION_DENIED error', () => {
      useGeolocationStore.getState().requestLocation();

      const error = createMockPositionError(1, 'Permission denied');
      mockGeo._currentError!(error);

      const state = useGeolocationStore.getState();
      expect(state.status).toBe('denied');
      expect(state.error).toBe('Location access was denied');
    });

    it('handles POSITION_UNAVAILABLE error', () => {
      useGeolocationStore.getState().requestLocation();

      const error = createMockPositionError(2, 'Position unavailable');
      mockGeo._currentError!(error);

      const state = useGeolocationStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Location information is unavailable');
    });

    it('handles TIMEOUT error', () => {
      useGeolocationStore.getState().requestLocation();

      const error = createMockPositionError(3, 'Timeout');
      mockGeo._currentError!(error);

      const state = useGeolocationStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Location request timed out');
    });

    it('sets error when geolocation is not supported', () => {
      Object.defineProperty(globalThis.navigator, 'geolocation', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      useGeolocationStore.getState().requestLocation();

      const state = useGeolocationStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Geolocation is not supported by your browser');
    });
  });

  describe('watchLocation', () => {
    it('sets status to requesting', () => {
      useGeolocationStore.getState().watchLocation();
      expect(useGeolocationStore.getState().status).toBe('requesting');
    });

    it('calls watchPosition', () => {
      useGeolocationStore.getState().watchLocation();
      expect(mockGeo.watchPosition).toHaveBeenCalledOnce();
    });

    it('updates position on watch callback', () => {
      useGeolocationStore.getState().watchLocation();

      const mockPos = createMockPosition(40.758, -73.9855, 20);
      mockGeo._watchCallbacks[0].success(mockPos);

      const state = useGeolocationStore.getState();
      expect(state.position).toEqual({ lat: 40.758, lon: -73.9855 });
      expect(state.accuracy).toBe(20);
      expect(state.status).toBe('active');
    });

    it('clears existing watch before starting new one', () => {
      // Start first watch (returns id 1)
      useGeolocationStore.getState().watchLocation();
      expect(mockGeo.watchPosition).toHaveBeenCalledTimes(1);

      // Start second watch — should clear first
      useGeolocationStore.getState().watchLocation();
      expect(mockGeo.clearWatch).toHaveBeenCalledWith(1);
      expect(mockGeo.watchPosition).toHaveBeenCalledTimes(2);
    });

    it('handles error in watch callback', () => {
      useGeolocationStore.getState().watchLocation();

      const error = createMockPositionError(1, 'Permission denied');
      mockGeo._watchCallbacks[0].error(error);

      const state = useGeolocationStore.getState();
      expect(state.status).toBe('denied');
      expect(state.error).toBe('Location access was denied');
    });

    it('sets error when geolocation is not supported', () => {
      Object.defineProperty(globalThis.navigator, 'geolocation', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      useGeolocationStore.getState().watchLocation();

      const state = useGeolocationStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Geolocation is not supported by your browser');
    });
  });

  describe('stopWatching', () => {
    it('clears the watch and resets status to idle', () => {
      // Start watching (sets module-level _watchId to 1)
      useGeolocationStore.getState().watchLocation();

      useGeolocationStore.getState().stopWatching();

      expect(mockGeo.clearWatch).toHaveBeenCalledWith(1);
      expect(useGeolocationStore.getState().status).toBe('idle');
    });

    it('does nothing when no watch is active', () => {
      // Without starting a watch first, stopWatching should be a no-op
      useGeolocationStore.getState().stopWatching();
      expect(mockGeo.clearWatch).not.toHaveBeenCalled();
    });
  });

  describe('clearError', () => {
    it('clears the error message', () => {
      useGeolocationStore.setState({ error: 'Some error', status: 'error' });

      useGeolocationStore.getState().clearError();

      expect(useGeolocationStore.getState().error).toBeNull();
    });
  });
});
