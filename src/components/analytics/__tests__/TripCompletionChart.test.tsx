import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TripCompletionChart } from '../TripCompletionChart';
import {
  createMockDailyRollup,
  createMockRollupDataProp,
} from '@/test/factories';
import { format } from 'date-fns';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

describe('TripCompletionChart', () => {
  // TripCompletionChart filters to "today" only
  const today = format(new Date(), 'yyyy-MM-dd');

  it('renders loading skeleton when loading is true', () => {
    const rollup = createMockRollupDataProp({ loading: true });
    render(<TripCompletionChart rollupData={rollup} />);

    expect(screen.getByText('Trip Volume by Route')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders empty state when no data for today', () => {
    // Provide data from yesterday only
    const rollups = [
      createMockDailyRollup({ routeId: '1', date: '2020-01-01#N', totalTrips: 100 }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<TripCompletionChart rollupData={rollup} />);

    expect(screen.getByText('Trip Intelligence')).toBeInTheDocument();
    expect(screen.getByText(/Collecting trip lifecycle data/)).toBeInTheDocument();
  });

  it('renders empty state when rollupData is undefined', () => {
    render(<TripCompletionChart />);

    expect(screen.getByText('Trip Intelligence')).toBeInTheDocument();
  });

  it('renders bar chart when today data is provided', () => {
    const rollups = [
      createMockDailyRollup({ routeId: '1', date: `${today}#N`, totalTrips: 80 }),
      createMockDailyRollup({ routeId: '1', date: `${today}#S`, totalTrips: 70 }),
      createMockDailyRollup({ routeId: 'A', date: `${today}#N`, totalTrips: 60 }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<TripCompletionChart rollupData={rollup} />);

    expect(screen.getByText('Trip Volume by Route')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    // Total trips: 80+70+60 = 210
    expect(screen.getByText('210 trips today')).toBeInTheDocument();
  });

  it('handles data with zero trips gracefully', () => {
    const rollups = [
      createMockDailyRollup({ routeId: '1', date: `${today}#N`, totalTrips: 0 }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<TripCompletionChart rollupData={rollup} />);

    // 0-trip routes are filtered out, so empty state should show
    expect(screen.getByText('Trip Intelligence')).toBeInTheDocument();
  });
});
