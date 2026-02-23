'use client';

import { create } from 'zustand';

/**
 * Alerts UI Store
 *
 * Manages UI-only state for alerts (dismissed IDs).
 * Server state (alerts data) is managed by React Query in use-alerts.ts.
 *
 * NOTE: `dismissedIds` is a Set<string> for O(1) lookups. This store does NOT
 * use Zustand persist middleware. If persistence is ever added, Set must be
 * converted to string[] for JSON serialization (Set serializes to `{}`).
 */
interface AlertsUIState {
  dismissedIds: Set<string>;
  dismissAlert: (id: string) => void;
  clearDismissed: () => void;
}

export const useAlertsStore = create<AlertsUIState>((set) => ({
  dismissedIds: new Set(),

  dismissAlert: (id) =>
    set((state) => {
      const dismissedIds = new Set(state.dismissedIds);
      dismissedIds.add(id);
      return { dismissedIds };
    }),

  clearDismissed: () => set({ dismissedIds: new Set() }),
}));
