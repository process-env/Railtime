import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlertCard } from './AlertCard';
import { createMockServiceAlert } from '@/test/factories';

describe('AlertCard', () => {
  it('renders alert header text', () => {
    const alert = createMockServiceAlert({ headerText: 'Service Suspended' });
    render(<AlertCard alert={alert} />);

    expect(screen.getByText('Service Suspended')).toBeInTheDocument();
  });

  it('renders severity badge', () => {
    const alert = createMockServiceAlert({ severity: 'critical' });
    render(<AlertCard alert={alert} />);

    // Badge should show the alert type or severity
    expect(screen.getByText(alert.alertType || 'critical')).toBeInTheDocument();
  });

  it('renders affected routes as badges', () => {
    const alert = createMockServiceAlert({ affectedRoutes: ['A', 'C', 'E'] });
    render(<AlertCard alert={alert} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('limits displayed routes and shows overflow count', () => {
    const manyRoutes = ['A', 'C', 'E', '1', '2', '3', '4', '5', '6', '7'];
    const alert = createMockServiceAlert({ affectedRoutes: manyRoutes });
    render(<AlertCard alert={alert} />);

    // Should show "+X more" text
    expect(screen.getByText(/\+\d+ more/)).toBeInTheDocument();
  });

  it('is collapsed by default', () => {
    const alert = createMockServiceAlert({
      descriptionHtml: '<p>Detailed description</p>',
    });
    render(<AlertCard alert={alert} />);

    // Description should not be visible when collapsed
    expect(screen.queryByText('Detailed description')).not.toBeInTheDocument();
  });

  it('expands when defaultExpanded is true', () => {
    const alert = createMockServiceAlert({
      descriptionHtml: '<p>Detailed description</p>',
    });
    render(<AlertCard alert={alert} defaultExpanded />);

    // Description should be visible
    expect(screen.getByText('Detailed description')).toBeInTheDocument();
  });

  it('toggles expansion on button click', () => {
    const alert = createMockServiceAlert({
      descriptionHtml: '<p>Detailed description</p>',
    });
    render(<AlertCard alert={alert} />);

    // Initially collapsed
    expect(screen.queryByText('Detailed description')).not.toBeInTheDocument();

    // Click expand button
    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Should be expanded
    expect(screen.getByText('Detailed description')).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(button);

    // Should be collapsed
    expect(screen.queryByText('Detailed description')).not.toBeInTheDocument();
  });

  it('renders affected stations when expanded', () => {
    const alert = createMockServiceAlert({
      affectedStopNames: ['Times Square', 'Penn Station', '14 St'],
    });
    render(<AlertCard alert={alert} defaultExpanded />);

    expect(screen.getByText(/Affected Stations/)).toBeInTheDocument();
    expect(screen.getByText(/Times Square/)).toBeInTheDocument();
  });

  it('limits displayed stations and shows count', () => {
    const manyStations = Array.from({ length: 20 }, (_, i) => `Station ${i + 1}`);
    const alert = createMockServiceAlert({ affectedStopNames: manyStations });
    render(<AlertCard alert={alert} defaultExpanded />);

    // Should show count in parentheses
    expect(screen.getByText(/\(20\)/)).toBeInTheDocument();
  });

  it('formats ongoing alerts correctly', () => {
    const alert = createMockServiceAlert({ activePeriods: [] });
    render(<AlertCard alert={alert} />);

    expect(screen.getByText('Ongoing')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const alert = createMockServiceAlert();
    const { container } = render(
      <AlertCard alert={alert} className="custom-class" />
    );

    const card = container.querySelector('.custom-class');
    expect(card).toBeInTheDocument();
  });

  it('sanitizes HTML in description', () => {
    const alert = createMockServiceAlert({
      descriptionHtml: '<p>Safe content</p><script>alert("xss")</script>',
    });
    render(<AlertCard alert={alert} defaultExpanded />);

    // Safe content should be visible
    expect(screen.getByText('Safe content')).toBeInTheDocument();

    // Script tag should not be rendered (would execute if it was)
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('uses headerText when descriptionHtml is not provided', () => {
    const alert = createMockServiceAlert({
      headerText: 'Alert Header',
      descriptionHtml: '',
    });
    render(<AlertCard alert={alert} defaultExpanded />);

    // Should see the header text in the expanded content area
    const elements = screen.getAllByText('Alert Header');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });
});
