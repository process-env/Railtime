import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutePerformanceTable } from '../RoutePerformanceTable';
import {
  createMockDailyRollups,
  createMockRollupDataProp,
  createMockDailyRollup,
} from '@/test/factories';

// Mock getRouteColor to return a stable value
vi.mock('@/lib/constants', () => ({
  getRouteColor: (routeId: string) => `#${routeId.charCodeAt(0).toString(16).padStart(6, '0')}`,
}));

describe('RoutePerformanceTable', () => {
  it('renders loading skeleton when loading is true', () => {
    const rollup = createMockRollupDataProp({ loading: true });
    render(<RoutePerformanceTable rollupData={rollup} />);

    expect(screen.getByText(/Route Performance/)).toBeInTheDocument();
    // No table rows or empty message during loading
    expect(screen.queryByText('No performance data available yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders empty state when no data is provided', () => {
    const rollup = createMockRollupDataProp({ rollups: [] });
    render(<RoutePerformanceTable rollupData={rollup} />);

    expect(screen.getByText('No performance data available yet.')).toBeInTheDocument();
  });

  it('renders empty state when rollupData is undefined', () => {
    render(<RoutePerformanceTable />);

    expect(screen.getByText('No performance data available yet.')).toBeInTheDocument();
  });

  it('renders table with route rows when data is provided', () => {
    const rollups = createMockDailyRollups(['1', 'A', 'L'], 2);
    const rollup = createMockRollupDataProp({ rollups });
    render(<RoutePerformanceTable rollupData={rollup} />);

    // Table headers should be present
    expect(screen.getByText('Route')).toBeInTheDocument();
    expect(screen.getByText('Grade')).toBeInTheDocument();
    expect(screen.getByText('On-Time %')).toBeInTheDocument();
    expect(screen.getByText('Avg Delay')).toBeInTheDocument();
    expect(screen.getByText('Headway')).toBeInTheDocument();

    // Route IDs should appear as text content in the pill badges
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('shows grades for routes with on-time data', () => {
    const rollups = [
      createMockDailyRollup({
        routeId: '1',
        date: '2026-02-24#N',
        onTimePercent: 95,
        avgDelay: 20,
        totalBunching: 0,
        totalGaps: 0,
        avgHeadway: 300,
        medianHeadway: 290,
      }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<RoutePerformanceTable rollupData={rollup} />);

    // Should show a grade letter (A, B, C, D, or F)
    const gradeCell = screen.getByText(/^[A-F]$/);
    expect(gradeCell).toBeInTheDocument();
  });

  it('filters out routes with all null metrics', () => {
    const rollups = [
      createMockDailyRollup({
        routeId: 'G',
        date: '2026-02-24#N',
        onTimePercent: null,
        avgDelay: null,
        avgHeadway: null,
      }),
    ];
    const rollup = createMockRollupDataProp({ rollups });
    render(<RoutePerformanceTable rollupData={rollup} />);

    // Route G should be filtered out since all metrics are null
    expect(screen.queryByText('G')).not.toBeInTheDocument();
  });
});
