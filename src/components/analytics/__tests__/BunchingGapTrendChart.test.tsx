import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BunchingGapTrendChart } from '../BunchingGapTrendChart';
import {
  createMockDailyRollups,
  createMockRollupDataProp,
} from '@/test/factories';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

describe('BunchingGapTrendChart', () => {
  it('renders loading skeleton when loading is true', () => {
    const rollup = createMockRollupDataProp({ loading: true });
    render(<BunchingGapTrendChart rollupData={rollup} />);

    expect(screen.getByText('Routes with Bunching / Gaps')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('No trend data available')).not.toBeInTheDocument();
  });

  it('renders empty state when no data is provided', () => {
    const rollup = createMockRollupDataProp({ rollups: [] });
    render(<BunchingGapTrendChart rollupData={rollup} />);

    expect(screen.getByText('No trend data available')).toBeInTheDocument();
  });

  it('renders empty state when rollupData is undefined', () => {
    render(<BunchingGapTrendChart />);

    expect(screen.getByText('No trend data available')).toBeInTheDocument();
  });

  it('renders chart when data is provided', () => {
    const rollups = createMockDailyRollups(['1', 'A', 'L'], 5);
    const rollup = createMockRollupDataProp({ rollups });
    render(<BunchingGapTrendChart rollupData={rollup} />);

    expect(screen.getByText('Routes with Bunching / Gaps')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('renders period toggle buttons', () => {
    const rollup = createMockRollupDataProp({ rollups: [] });
    render(<BunchingGapTrendChart rollupData={rollup} />);

    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
  });
});
