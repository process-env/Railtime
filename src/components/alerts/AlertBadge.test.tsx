import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBadge } from './AlertBadge';

// Mutable mock state for useAlertsData
const mockAlertsData = {
  alerts: [] as { id: string; severity: string }[],
  visibleAlerts: [] as { id: string; severity: string }[],
  isLoading: false,
  error: null as string | null,
  refetch: vi.fn().mockResolvedValue(undefined),
  counts: { critical: 0, warning: 0, info: 0 },
  dismissAlert: vi.fn(),
  clearDismissed: vi.fn(),
};

vi.mock('@/components/providers/AlertsProvider', () => ({
  useAlertsData: () => mockAlertsData,
}));

describe('AlertBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock - no alerts
    mockAlertsData.alerts = [];
    mockAlertsData.visibleAlerts = [];
    mockAlertsData.isLoading = false;
    mockAlertsData.error = null;
    mockAlertsData.counts = { critical: 0, warning: 0, info: 0 };
  });

  it('renders nothing when no alerts and showZero is false', () => {
    const { container } = render(<AlertBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('renders zero when showZero is true', () => {
    render(<AlertBadge showZero />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows total alert count', () => {
    mockAlertsData.counts = { critical: 1, warning: 1, info: 1 };

    render(<AlertBadge />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('uses critical color when critical alerts present', () => {
    mockAlertsData.counts = { critical: 1, warning: 1, info: 0 };

    const { container } = render(<AlertBadge />);
    const badge = container.querySelector('span');
    // Should have critical styling (red background)
    expect(badge?.className).toContain('bg-red');
  });

  it('uses warning color when no critical but warning present', () => {
    mockAlertsData.counts = { critical: 0, warning: 1, info: 1 };

    const { container } = render(<AlertBadge />);
    const badge = container.querySelector('span');
    // Should have warning styling (amber/yellow background)
    expect(badge?.className).toMatch(/bg-(amber|yellow)/);
  });

  it('uses info color when only info alerts present', () => {
    mockAlertsData.counts = { critical: 0, warning: 0, info: 1 };

    const { container } = render(<AlertBadge />);
    const badge = container.querySelector('span');
    // Should have info styling (blue background)
    expect(badge?.className).toContain('bg-blue');
  });

  it('applies custom className', () => {
    mockAlertsData.counts = { critical: 0, warning: 1, info: 0 };

    const { container } = render(<AlertBadge className="custom-class" />);
    const badge = container.querySelector('.custom-class');
    expect(badge).toBeInTheDocument();
  });

  it('renders with proper accessibility', () => {
    mockAlertsData.counts = { critical: 0, warning: 1, info: 0 };

    const { container } = render(<AlertBadge />);
    const badge = container.querySelector('span');
    // Should be a span element
    expect(badge?.tagName).toBe('SPAN');
  });
});
