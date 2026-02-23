import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBanner } from './AlertBanner';
import { createMockServiceAlert } from '@/test/factories';
import type { ServiceAlert } from '@/types/mta';

// Mutable mock state for useAlertsData
const mockAlertsData = {
  alerts: [] as ServiceAlert[],
  visibleAlerts: [] as ServiceAlert[],
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

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
      const { className } = props;
      return <div className={className}>{children}</div>;
    },
  },
  useAnimationControls: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    set: vi.fn(),
  }),
}));

function setMockAlerts(alerts: ServiceAlert[]) {
  mockAlertsData.alerts = alerts;
  mockAlertsData.visibleAlerts = alerts;
  mockAlertsData.counts = {
    critical: alerts.filter((a) => a.severity === 'critical').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    info: alerts.filter((a) => a.severity === 'info').length,
  };
}

describe('AlertBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock - no alerts
    mockAlertsData.alerts = [];
    mockAlertsData.visibleAlerts = [];
    mockAlertsData.isLoading = false;
    mockAlertsData.error = null;
    mockAlertsData.counts = { critical: 0, warning: 0, info: 0 };
  });

  it('renders nothing when no alerts', () => {
    const { container } = render(<AlertBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders critical alerts section', () => {
    setMockAlerts([
      createMockServiceAlert({ severity: 'critical', headerText: 'Critical Alert' }),
    ]);

    render(<AlertBanner />);
    // Ticker duplicates content for seamless loop
    expect(screen.getAllByText('Critical Alert').length).toBeGreaterThan(0);
  });

  it('renders warning alerts section', () => {
    setMockAlerts([
      createMockServiceAlert({ severity: 'warning', headerText: 'Warning Alert' }),
    ]);

    render(<AlertBanner />);
    expect(screen.getAllByText('Warning Alert').length).toBeGreaterThan(0);
  });

  it('renders info alerts section', () => {
    setMockAlerts([
      createMockServiceAlert({ severity: 'info', headerText: 'Info Alert' }),
    ]);

    render(<AlertBanner />);
    expect(screen.getAllByText('Info Alert').length).toBeGreaterThan(0);
  });

  it('renders alerts grouped by severity', () => {
    setMockAlerts([
      createMockServiceAlert({ severity: 'critical', headerText: 'Critical One' }),
      createMockServiceAlert({ severity: 'warning', headerText: 'Warning One' }),
      createMockServiceAlert({ severity: 'info', headerText: 'Info One' }),
    ]);

    render(<AlertBanner />);
    // Ticker duplicates content for seamless loop
    expect(screen.getAllByText('Critical One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Warning One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Info One').length).toBeGreaterThan(0);
  });

  it('renders route badges for affected routes', () => {
    setMockAlerts([
      createMockServiceAlert({
        severity: 'critical',
        headerText: 'Test Alert',
        affectedRoutes: ['A', 'C', 'E'],
      }),
    ]);

    render(<AlertBanner />);
    // Ticker duplicates content for seamless loop
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('C').length).toBeGreaterThan(0);
    expect(screen.getAllByText('E').length).toBeGreaterThan(0);
  });

  it('limits displayed routes and shows overflow count', () => {
    setMockAlerts([
      createMockServiceAlert({
        severity: 'critical',
        headerText: 'Test Alert',
        affectedRoutes: ['1', '2', '3', '4', '5', '6', '7', 'A', 'B', 'C'],
      }),
    ]);

    render(<AlertBanner />);
    // Should show +X for overflow routes
    expect(screen.getAllByText(/\+\d+/).length).toBeGreaterThan(0);
  });

  it('applies custom className', () => {
    setMockAlerts([
      createMockServiceAlert({ severity: 'critical' }),
    ]);

    const { container } = render(<AlertBanner className="custom-class" />);
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('does not render dismissed alerts', () => {
    // visibleAlerts excludes dismissed alerts, so provide empty visibleAlerts
    mockAlertsData.alerts = [
      createMockServiceAlert({
        id: 'dismissed-alert',
        severity: 'critical',
        headerText: 'Dismissed Alert',
      }),
    ];
    mockAlertsData.visibleAlerts = [];
    mockAlertsData.counts = { critical: 1, warning: 0, info: 0 };

    render(<AlertBanner />);
    expect(screen.queryByText('Dismissed Alert')).not.toBeInTheDocument();
  });

  it('renders multiple alerts of same severity', () => {
    setMockAlerts([
      createMockServiceAlert({ severity: 'critical', headerText: 'Critical One' }),
      createMockServiceAlert({ severity: 'critical', headerText: 'Critical Two' }),
    ]);

    render(<AlertBanner />);
    // Ticker duplicates content for seamless loop
    expect(screen.getAllByText('Critical One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Critical Two').length).toBeGreaterThan(0);
  });
});
