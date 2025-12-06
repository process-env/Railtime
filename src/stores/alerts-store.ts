'use client';

import { create } from 'zustand';

/**
 * Alerts UI Store
 *
 * Manages UI-only state for alerts (dismissed IDs).
 * Server state (alerts data) is managed by React Query in use-alerts.ts.
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
