import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveSystemDashboard } from '../LiveSystemDashboard';

const mockFeedStatus = [
  { feedId: 'ACE', lastPoll: '2026-02-24T12:00:00Z', tripCount: 45, status: 'healthy' as const },
  { feedId: 'BDFM', lastPoll: '2026-02-24T12:00:00Z', tripCount: 38, status: 'healthy' as const },
  { feedId: 'G', lastPoll: '2026-02-24T11:55:00Z', tripCount: 8, status: 'stale' as const },
  { feedId: 'L', lastPoll: '2026-02-24T11:50:00Z', tripCount: 0, status: 'error' as const },
];

describe('LiveSystemDashboard', () => {
  it('renders loading state with skeletons', () => {
    render(
      <LiveSystemDashboard
        totalTrains={0}
        feedStatus={[]}
        alertCount={0}
        loading={true}
      />
    );

    expect(screen.getByText('Live System Status')).toBeInTheDocument();
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    // Should not show stats during loading
    expect(screen.queryByText('Active Trains')).not.toBeInTheDocument();
  });

  it('renders live badge when not loading', () => {
    render(
      <LiveSystemDashboard
        totalTrains={150}
        feedStatus={mockFeedStatus}
        alertCount={3}
        loading={false}
      />
    );

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
  });

  it('displays total trains, feed groups count, and alert count', () => {
    render(
      <LiveSystemDashboard
        totalTrains={150}
        feedStatus={mockFeedStatus}
        alertCount={3}
      />
    );

    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Active Trains')).toBeInTheDocument();

    // "4" is the feed group count stat
    expect(screen.getByText('4')).toBeInTheDocument();

    // "Feed Groups" appears twice: once as the stat label, once as section header
    const feedGroupLabels = screen.getAllByText('Feed Groups');
    expect(feedGroupLabels.length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Active Alerts')).toBeInTheDocument();
  });

  it('renders feed group breakdown with correct statuses', () => {
    render(
      <LiveSystemDashboard
        totalTrains={91}
        feedStatus={mockFeedStatus}
        alertCount={5}
      />
    );

    // Feed group IDs
    expect(screen.getByText('ACE')).toBeInTheDocument();
    expect(screen.getByText('BDFM')).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();

    // Trip counts
    expect(screen.getByText('45 trains')).toBeInTheDocument();
    expect(screen.getByText('38 trains')).toBeInTheDocument();
    expect(screen.getByText('8 trains')).toBeInTheDocument();
    expect(screen.getByText('0 trains')).toBeInTheDocument();

    // Status badges — there are 2 healthy feeds, so use getAllByText
    const healthyBadges = screen.getAllByText('healthy');
    expect(healthyBadges).toHaveLength(2);
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('renders with zero trains and empty feed status', () => {
    render(
      <LiveSystemDashboard
        totalTrains={0}
        feedStatus={[]}
        alertCount={0}
      />
    );

    // Multiple "0" elements may exist (trains + feed groups + alerts)
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Active Trains')).toBeInTheDocument();
  });
});
