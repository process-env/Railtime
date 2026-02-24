import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SystemHealthTimeline } from '../SystemHealthTimeline';
import {
  createMockDailyRollups,
  createMockRollupDataProp,
  createMockDailyRollup,
} from '@/test/factories';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

describe('SystemHealthTimeline', () => {
  it('renders loading skeleton when loading is true', () => {
    const rollup = createMockRollupDataProp({ loading: true });
    render(<SystemHealthTimeline rollupData={rollup} />);

    expect(screen.getByText('System Health (30 days)')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('No health data available yet.')).not.toBeInTheDocument();
  });

  it('renders empty state when no data is provided', () => {
    const rollup = createMockRollupDataProp({ rollups: [] });
    render(<SystemHealthTimeline rollupData={rollup} />);

    expect(screen.getByText('No health data available yet.')).toBeInTheDocument();
  });

  it('renders empty state when rollupData is undefined', () => {
    render(<SystemHealthTimeline />);

    expect(screen.getByText('No health data available yet.')).toBeInTheDocument();
  });

  it('renders area chart when data is provided', () => {
    const rollups = createMockDailyRollups(['1', 'A', 'L'], 7);
    const rollup = createMockRollupDataProp({ rollups });
    render(<SystemHealthTimeline rollupData={rollup} />);

    expect(screen.getByText('System Health (30 days)')).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });

  it('handles data with null delays gracefully', () => {
    const rollups = [
      createMockDailyRollup({
        routeId: '1',
        date: '2026-02-24#N',
        avgDelay: null,
        onTimePercent: null,
      }),
      createMockDailyRollup({
        routeId: 'A',
        date: '2026-02-23#N',
        avgDelay: 100,
        onTimePercent: 75,
      }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<SystemHealthTimeline rollupData={rollup} />);

    // Should still render chart because we have at least one valid date
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});
