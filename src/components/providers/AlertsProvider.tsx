'use client';

import { createContext, useContext } from 'react';
import { useAlerts } from '@/hooks/use-alerts';
import type { ServiceAlert } from '@/types/mta';

/**
 * Shape of the alerts context — mirrors the return type of useAlerts().
 * A single useAlerts() call is made in the provider and shared with all
 * consumers via context, preventing duplicate Socket.IO subscriptions and
 * React Query polling instances.
 */
interface AlertsContextValue {
  alerts: ServiceAlert[];
  visibleAlerts: ServiceAlert[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<unknown>;
  counts: { critical: number; warning: number; info: number };
  dismissAlert: (id: string) => void;
  clearDismissed: () => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

/**
 * Provides a single shared useAlerts() call to all descendant consumers.
 * Place this at the dashboard layout level so that AlertBanner, AlertBadge,
 * AlertStatusCard, AppSidebar, and page components all share one data source.
 */
export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const alertsData = useAlerts();

  return (
    <AlertsContext.Provider value={alertsData}>
      {children}
    </AlertsContext.Provider>
  );
}

/**
 * Consume the shared alerts data from AlertsProvider.
 * Throws if used outside of an AlertsProvider.
 */
export function useAlertsData(): AlertsContextValue {
  const context = useContext(AlertsContext);
  if (!context) {
    throw new Error('useAlertsData must be used within an AlertsProvider');
  }
  return context;
}
