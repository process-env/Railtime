import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperationalStatsBar } from '../OperationalStatsBar';
import type { OperationalStats } from '@/hooks/use-operational-stats';

// Mock the useOperationalStats hook
const mockStats: OperationalStats = {
  activeTrains: 0,
  onTimePercent: null,
  bunchingToday: 0,
  gapsToday: 0,
  alertCount: 0,
  feedHealth: 0,
  loading: false,
};

vi.mock('@/hooks/use-operational-stats', () => ({
  useOperationalStats: () => mockStats,
}));

describe('OperationalStatsBar', () => {
  it('renders loading skeletons when loading is true', () => {
    mockStats.loading = true;
    render(<OperationalStatsBar />);

    // During loading, stat labels should not be visible
    expect(screen.queryByText('Active Trains')).not.toBeInTheDocument();
    expect(screen.queryByText('System On-Time')).not.toBeInTheDocument();

    // Reset
    mockStats.loading = false;
  });

  it('renders all four stat cards when loaded', () => {
    mockStats.activeTrains = 245;
    mockStats.onTimePercent = 87.5;
    mockStats.bunchingToday = 3;
    mockStats.gapsToday = 2;

    render(<OperationalStatsBar />);

    expect(screen.getByText('Active Trains')).toBeInTheDocument();
    expect(screen.getByText('245')).toBeInTheDocument();

    expect(screen.getByText('System On-Time')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();

    expect(screen.getByText('Bunching Routes')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    expect(screen.getByText('Gap Routes')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows "--" when onTimePercent is null', () => {
    mockStats.activeTrains = 100;
    mockStats.onTimePercent = null;

    render(<OperationalStatsBar />);

    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('renders zero values without error', () => {
    mockStats.activeTrains = 0;
    mockStats.onTimePercent = 0;
    mockStats.bunchingToday = 0;
    mockStats.gapsToday = 0;

    render(<OperationalStatsBar />);

    expect(screen.getByText('Active Trains')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
