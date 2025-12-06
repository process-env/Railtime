import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBanner } from './AlertBanner';
import { useAlertsStore } from '@/stores';
import { createMockServiceAlert } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

describe('AlertBanner', () => {
  const mockAlerts = [
    createMockServiceAlert({ id: 'alert1', severity: 'critical', headerText: 'Critical Alert' }),
  ];

  beforeEach(() => {
    // Reset store state (for dismissedIds)
    useAlertsStore.setState({
      dismissedIds: new Set(),
    });

    vi.clearAllMocks();

    // Default mock - no alerts
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ alerts: [] }),
    });
  });

  it('renders nothing when no alerts', async () => {
    const { container } = render(<AlertBanner />, { wrapper: QueryWrapper });
    // Wait for fetch to complete
    await vi.waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders critical alerts section', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert({ severity: 'critical', headerText: 'Critical Alert' })],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      // Ticker duplicates content for seamless loop
      expect(screen.getAllByText('Critical Alert').length).toBeGreaterThan(0);
    });
  });

  it('renders warning alerts section', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert({ severity: 'warning', headerText: 'Warning Alert' })],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(screen.getAllByText('Warning Alert').length).toBeGreaterThan(0);
    });
  });

  it('renders info alerts section', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert({ severity: 'info', headerText: 'Info Alert' })],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(screen.getAllByText('Info Alert').length).toBeGreaterThan(0);
    });
  });

  it('renders alerts grouped by severity', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({ severity: 'critical', headerText: 'Critical One' }),
          createMockServiceAlert({ severity: 'warning', headerText: 'Warning One' }),
          createMockServiceAlert({ severity: 'info', headerText: 'Info One' }),
        ],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      // Ticker duplicates content for seamless loop
      expect(screen.getAllByText('Critical One').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Warning One').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Info One').length).toBeGreaterThan(0);
    });
  });

  it('renders route badges for affected routes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({
            severity: 'critical',
            headerText: 'Test Alert',
            affectedRoutes: ['A', 'C', 'E'],
          }),
        ],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      // Ticker duplicates content for seamless loop
      expect(screen.getAllByText('A').length).toBeGreaterThan(0);
      expect(screen.getAllByText('C').length).toBeGreaterThan(0);
      expect(screen.getAllByText('E').length).toBeGreaterThan(0);
    });
  });

  it('limits displayed routes and shows overflow count', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({
            severity: 'critical',
            headerText: 'Test Alert',
            affectedRoutes: ['1', '2', '3', '4', '5', '6', '7', 'A', 'B', 'C'],
          }),
        ],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      // Should show +X for overflow routes
      expect(screen.getAllByText(/\+\d+/).length).toBeGreaterThan(0);
    });
  });

  it('applies custom className', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert({ severity: 'critical' })],
      }),
    });

    const { container } = render(<AlertBanner className="custom-class" />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  it('does not render dismissed alerts', async () => {
    const dismissedAlertId = 'dismissed-alert';

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({
            id: dismissedAlertId,
            severity: 'critical',
            headerText: 'Dismissed Alert',
          }),
        ],
      }),
    });

    // Pre-dismiss the alert
    useAlertsStore.setState({
      dismissedIds: new Set([dismissedAlertId]),
    });

    const { container } = render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(screen.queryByText('Dismissed Alert')).not.toBeInTheDocument();
    });
  });

  it('renders multiple alerts of same severity', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({ severity: 'critical', headerText: 'Critical One' }),
          createMockServiceAlert({ severity: 'critical', headerText: 'Critical Two' }),
        ],
      }),
    });

    render(<AlertBanner />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      // Ticker duplicates content for seamless loop
      expect(screen.getAllByText('Critical One').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Critical Two').length).toBeGreaterThan(0);
    });
  });
});
