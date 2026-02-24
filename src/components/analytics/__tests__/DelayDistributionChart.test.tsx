import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DelayDistributionChart } from '../DelayDistributionChart';
import {
  createMockDailyRollups,
  createMockRollupDataProp,
  createMockDailyRollup,
} from '@/test/factories';

// Mock recharts — render children without SVG
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => <div data-testid="pie" />,
  Cell: () => <div data-testid="cell" />,
  Legend: () => <div data-testid="legend" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

describe('DelayDistributionChart', () => {
  it('renders loading skeleton when loading is true', () => {
    const rollup = createMockRollupDataProp({ loading: true });
    render(<DelayDistributionChart rollupData={rollup} />);

    expect(screen.getByText('Delay Distribution')).toBeInTheDocument();
    // Skeleton should be present (no chart, no empty message)
    expect(screen.queryByText('No delay data collected yet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('renders empty state when no data is provided', () => {
    const rollup = createMockRollupDataProp({ rollups: [] });
    render(<DelayDistributionChart rollupData={rollup} />);

    expect(screen.getByText('Delay Distribution')).toBeInTheDocument();
    expect(screen.getByText('No delay data collected yet')).toBeInTheDocument();
  });

  it('renders empty state when rollupData is undefined', () => {
    render(<DelayDistributionChart />);

    expect(screen.getByText('Delay Distribution')).toBeInTheDocument();
    expect(screen.getByText('No delay data collected yet')).toBeInTheDocument();
  });

  it('renders chart when data is provided', () => {
    const rollups = createMockDailyRollups(['1', 'A'], 3);
    const rollup = createMockRollupDataProp({ rollups });
    render(<DelayDistributionChart rollupData={rollup} />);

    expect(screen.getByText('Delay Distribution')).toBeInTheDocument();
    expect(screen.getByText('7-day avg')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('renders in compact mode with smaller dimensions', () => {
    const rollups = createMockDailyRollups(['1'], 2);
    const rollup = createMockRollupDataProp({ rollups });
    render(<DelayDistributionChart compact rollupData={rollup} />);

    expect(screen.getByText('Delay Distribution')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('handles data with all null onTimePercent gracefully', () => {
    const rollups = [
      createMockDailyRollup({ routeId: '1', onTimePercent: null, avgDelay: null }),
      createMockDailyRollup({ routeId: 'A', onTimePercent: null, avgDelay: null }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<DelayDistributionChart rollupData={rollup} />);

    // With all null onTimePercent, distribution should be empty
    expect(screen.getByText('No delay data collected yet')).toBeInTheDocument();
  });
});
