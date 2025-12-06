import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArrivalBoard } from './ArrivalBoard';
import { createMockArrival } from '@/test/factories';

describe('ArrivalBoard', () => {
  it('renders loading skeleton when loading', () => {
    const { container } = render(<ArrivalBoard arrivals={[]} loading />);
    // Should have skeleton elements
    expect(container.querySelectorAll('.h-16').length).toBeGreaterThan(0);
  });

  it('renders empty state when no arrivals', () => {
    render(<ArrivalBoard arrivals={[]} />);
    expect(screen.getByText('No upcoming arrivals')).toBeInTheDocument();
  });

  it('renders northbound section header', () => {
    const arrivals = [createMockArrival({ stopId: '101N' })];
    render(<ArrivalBoard arrivals={arrivals} />);
    expect(screen.getByText('Northbound / Manhattan')).toBeInTheDocument();
  });

  it('renders southbound section header', () => {
    const arrivals = [createMockArrival({ stopId: '101S' })];
    render(<ArrivalBoard arrivals={arrivals} />);
    expect(screen.getByText('Southbound / Brooklyn')).toBeInTheDocument();
  });

  it('groups arrivals by direction', () => {
    const arrivals = [
      createMockArrival({ stopId: '101N', stopName: 'North Station' }),
      createMockArrival({ stopId: '102S', stopName: 'South Station' }),
    ];

    render(<ArrivalBoard arrivals={arrivals} />);

    expect(screen.getByText('North Station')).toBeInTheDocument();
    expect(screen.getByText('South Station')).toBeInTheDocument();
  });

  it('shows "No trains" when no northbound arrivals', () => {
    const arrivals = [createMockArrival({ stopId: '101S' })];
    render(<ArrivalBoard arrivals={arrivals} />);

    const noTrainsElements = screen.getAllByText('No trains');
    expect(noTrainsElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "No trains" when no southbound arrivals', () => {
    const arrivals = [createMockArrival({ stopId: '101N' })];
    render(<ArrivalBoard arrivals={arrivals} />);

    const noTrainsElements = screen.getAllByText('No trains');
    expect(noTrainsElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders route badge with correct route', () => {
    const arrivals = [createMockArrival({ routeId: 'A', stopId: '101N' })];
    render(<ArrivalBoard arrivals={arrivals} />);

    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders arrival time', () => {
    const arrivals = [createMockArrival({ in: '5 min', stopId: '101N' })];
    render(<ArrivalBoard arrivals={arrivals} />);

    expect(screen.getByText('5 min')).toBeInTheDocument();
  });

  it('renders local time', () => {
    const arrivals = [createMockArrival({ whenLocal: '12:05 PM', stopId: '101N' })];
    render(<ArrivalBoard arrivals={arrivals} />);

    expect(screen.getByText('12:05 PM')).toBeInTheDocument();
  });

  it('limits displayed arrivals per direction to 5', () => {
    const northboundArrivals = Array.from({ length: 10 }, (_, i) =>
      createMockArrival({
        stopId: '101N',
        stopName: `Station ${i + 1}`,
        tripId: `trip-${i}`,
      })
    );

    render(<ArrivalBoard arrivals={northboundArrivals} />);

    // Should only show 5 stations, not all 10
    expect(screen.queryByText('Station 6')).not.toBeInTheDocument();
  });

  it('handles missing stop name gracefully', () => {
    const arrivals = [
      createMockArrival({ stopId: '101N', stopName: undefined as any }),
    ];
    render(<ArrivalBoard arrivals={arrivals} />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('handles missing route ID gracefully', () => {
    const arrivals = [
      createMockArrival({ stopId: '101N', routeId: undefined as any }),
    ];
    render(<ArrivalBoard arrivals={arrivals} />);

    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
