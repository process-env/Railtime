import { vi } from 'vitest';
import { act } from '@testing-library/react';

/**
 * Reset a Zustand store to its initial state
 * Works with stores that have a getInitialState or similar pattern
 */
export function resetStore<T extends object>(
  useStore: { getState: () => T; setState: (state: Partial<T>) => void },
  initialState: T
): void {
  act(() => {
    useStore.setState(initialState);
  });
}

/**
 * Create a mock Zustand store for testing
 */
export function createMockStore<T extends object>(initialState: T) {
  let state = { ...initialState };
  const listeners = new Set<(state: T) => void>();

  const store = {
    getState: () => state,
    setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => {
      const nextState = typeof partial === 'function'
        ? partial(state)
        : partial;
      state = { ...state, ...nextState };
      listeners.forEach(listener => listener(state));
    },
    subscribe: (listener: (state: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => {
      listeners.clear();
    },
    reset: () => {
      state = { ...initialState };
      listeners.forEach(listener => listener(state));
    },
  };

  return store;
}

/**
 * Mock store state for a specific test
 */
export function mockStoreState<T>(
  useStore: { setState: (state: Partial<T>) => void },
  state: Partial<T>
): void {
  act(() => {
    useStore.setState(state);
  });
}

/**
 * Spy on store actions
 */
export function spyOnStoreAction<T extends object, K extends keyof T>(
  useStore: { getState: () => T },
  actionName: K
): ReturnType<typeof vi.fn> {
  const originalAction = useStore.getState()[actionName];
  if (typeof originalAction !== 'function') {
    throw new Error(`${String(actionName)} is not a function`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spy = vi.fn(originalAction as (...args: any[]) => any);
  return spy;
}

/**
 * Initial states for dashboard stores
 */
export const initialTrainsState = {
  trains: {},
};

export const initialAlertsState = {
  dismissedIds: new Set<string>(),
};

export const initialUIState = {
  theme: 'system' as const,
  sidebarOpen: true,
  selectedStationId: null,
  selectedTrainId: null,
  selectedRouteIds: [] as string[],
  mapCenter: [-73.9857, 40.7484] as [number, number],
  mapZoom: 12,
};
