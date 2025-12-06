import { describe, it, expect, beforeEach } from 'vitest';
import { useAlertsStore } from './alerts-store';

describe('useAlertsStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useAlertsStore.setState({
      dismissedIds: new Set(),
    });
  });

  describe('initial state', () => {
    it('has empty dismissedIds Set', () => {
      expect(useAlertsStore.getState().dismissedIds.size).toBe(0);
    });
  });

  describe('dismissAlert', () => {
    it('adds alert ID to dismissedIds', () => {
      useAlertsStore.getState().dismissAlert('alert1');
      expect(useAlertsStore.getState().dismissedIds.has('alert1')).toBe(true);
    });

    it('preserves previously dismissed IDs', () => {
      useAlertsStore.getState().dismissAlert('alert1');
      useAlertsStore.getState().dismissAlert('alert2');

      const { dismissedIds } = useAlertsStore.getState();
      expect(dismissedIds.has('alert1')).toBe(true);
      expect(dismissedIds.has('alert2')).toBe(true);
    });

    it('handles dismissing same alert twice', () => {
      useAlertsStore.getState().dismissAlert('alert1');
      useAlertsStore.getState().dismissAlert('alert1');

      expect(useAlertsStore.getState().dismissedIds.size).toBe(1);
    });
  });

  describe('clearDismissed', () => {
    it('clears all dismissed IDs', () => {
      useAlertsStore.getState().dismissAlert('alert1');
      useAlertsStore.getState().dismissAlert('alert2');

      useAlertsStore.getState().clearDismissed();

      expect(useAlertsStore.getState().dismissedIds.size).toBe(0);
    });
  });
});
