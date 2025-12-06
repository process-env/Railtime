import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StationCard } from './StationCard';
import { createMockStop } from '@/test/factories';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/stations',
  useSearchParams: () => new URLSearchParams(),
}));

describe('StationCard', () => {
  it('renders station name', () => {
    const station = createMockStop({ name: 'Times Square', crossStreet: 'Broadway' });
    render(<StationCard station={station} />);

    // Station name is rendered in h3
    expect(screen.getByRole('heading', { name: 'Times Square' })).toBeInTheDocument();
  });

  it('renders route badges', () => {
    const station = createMockStop({ routes: 'A,C,E' });
    render(<StationCard station={station} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('handles space-separated routes', () => {
    const station = createMockStop({ routes: 'N R W' });
    render(<StationCard station={station} />);

    expect(screen.getByText('N')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('limits displayed routes to 6', () => {
    const station = createMockStop({ routes: '1,2,3,4,5,6,7,A,B,C' });
    render(<StationCard station={station} />);

    // Should show +4 more (10 routes - 6 displayed)
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('renders location name (cross street or station name)', () => {
    const station = createMockStop({ name: 'Penn Station', crossStreet: '7th Avenue' });
    render(<StationCard station={station} />);

    // Cross street is shown as location
    expect(screen.getByText('7th Avenue')).toBeInTheDocument();
  });

  it('links to station detail page', () => {
    const station = createMockStop({ id: '101' });
    render(<StationCard station={station} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/stations/101');
  });

  it('renders cross street from station data', () => {
    const station = createMockStop({
      name: '157 St',
      crossStreet: 'Broadway',
    });
    render(<StationCard station={station} />);

    expect(screen.getByText('Broadway')).toBeInTheDocument();
  });

  it('takes first cross street when multiple present', () => {
    const station = createMockStop({
      name: '231 St',
      crossStreet: 'Broadway, US Highway 9',
    });
    render(<StationCard station={station} />);

    expect(screen.getByText('Broadway')).toBeInTheDocument();
    expect(screen.queryByText(/US Highway/)).not.toBeInTheDocument();
  });

  it('shows station name when no cross street', () => {
    const station = createMockStop({
      name: 'Times Square',
      crossStreet: undefined,
    });
    render(<StationCard station={station} />);

    // Should show station name as the location
    expect(screen.getAllByText('Times Square').length).toBeGreaterThanOrEqual(1);
  });

  it('handles station with no routes', () => {
    const station = createMockStop({ routes: '' });
    const { container } = render(<StationCard station={station} />);

    // Should not throw, should render without route badges
    expect(container.querySelector('.font-medium')).toBeInTheDocument();
  });

  it('handles station with undefined routes', () => {
    const station = { ...createMockStop(), routes: undefined };
    const { container } = render(<StationCard station={station as any} />);

    // Should not throw
    expect(container).toBeDefined();
  });

  it('applies hover styling class', () => {
    const station = createMockStop();
    const { container } = render(<StationCard station={station} />);

    // Card should have hover styling
    const card = container.querySelector('.hover\\:bg-muted\\/50');
    expect(card).toBeInTheDocument();
  });
});
