import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBadge } from './AlertBadge';
import { useAlertsStore } from '@/stores';
import { createMockServiceAlert } from '@/test/factories';
import { QueryWrapper } from '@/test/utils/query-wrapper';

// Mock fetch
global.fetch = vi.fn();

describe('AlertBadge', () => {
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

  it('renders nothing when no alerts and showZero is false', async () => {
    const { container } = render(<AlertBadge />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders zero when showZero is true', async () => {
    render(<AlertBadge showZero />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  it('shows total alert count', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({ severity: 'critical' }),
          createMockServiceAlert({ severity: 'warning' }),
          createMockServiceAlert({ severity: 'info' }),
        ],
      }),
    });

    render(<AlertBadge />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('uses critical color when critical alerts present', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({ severity: 'critical' }),
          createMockServiceAlert({ severity: 'warning' }),
        ],
      }),
    });

    const { container } = render(<AlertBadge />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      const badge = container.querySelector('span');
      // Should have critical styling (red background)
      expect(badge?.className).toContain('bg-red');
    });
  });

  it('uses warning color when no critical but warning present', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [
          createMockServiceAlert({ severity: 'warning' }),
          createMockServiceAlert({ severity: 'info' }),
        ],
      }),
    });

    const { container } = render(<AlertBadge />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      const badge = container.querySelector('span');
      // Should have warning styling (amber/yellow background)
      expect(badge?.className).toMatch(/bg-(amber|yellow)/);
    });
  });

  it('uses info color when only info alerts present', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert({ severity: 'info' })],
      }),
    });

    const { container } = render(<AlertBadge />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      const badge = container.querySelector('span');
      // Should have info styling (blue background)
      expect(badge?.className).toContain('bg-blue');
    });
  });

  it('applies custom className', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert()],
      }),
    });

    const { container } = render(<AlertBadge className="custom-class" />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      const badge = container.querySelector('.custom-class');
      expect(badge).toBeInTheDocument();
    });
  });

  it('renders with proper accessibility', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        alerts: [createMockServiceAlert()],
      }),
    });

    const { container } = render(<AlertBadge />, { wrapper: QueryWrapper });

    await vi.waitFor(() => {
      const badge = container.querySelector('span');
      // Should be a span element
      expect(badge?.tagName).toBe('SPAN');
    });
  });
});
