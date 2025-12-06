import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertList } from './AlertList';
import { createMockServiceAlert } from '@/test/factories';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('AlertList', () => {
  it('renders empty state when no alerts', () => {
    render(<AlertList alerts={[]} />);
    expect(screen.getByText('No active service alerts')).toBeInTheDocument();
  });

  it('renders custom empty message', () => {
    render(<AlertList alerts={[]} emptyMessage="Custom empty message" />);
    expect(screen.getByText('Custom empty message')).toBeInTheDocument();
  });

  it('renders checkmark icon for empty state', () => {
    render(<AlertList alerts={[]} />);
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('renders list of alerts', () => {
    const alerts = [
      createMockServiceAlert({ headerText: 'Alert One' }),
      createMockServiceAlert({ headerText: 'Alert Two' }),
      createMockServiceAlert({ headerText: 'Alert Three' }),
    ];

    render(<AlertList alerts={alerts} />);

    expect(screen.getByText('Alert One')).toBeInTheDocument();
    expect(screen.getByText('Alert Two')).toBeInTheDocument();
    expect(screen.getByText('Alert Three')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <AlertList alerts={[]} className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('passes defaultExpanded to AlertCards', () => {
    const alerts = [
      createMockServiceAlert({
        headerText: 'Test Alert',
        descriptionHtml: '<p>Expanded content</p>',
      }),
    ];

    render(<AlertList alerts={alerts} defaultExpanded />);
    // If defaultExpanded is true, description should be visible
    expect(screen.getByText('Expanded content')).toBeInTheDocument();
  });

  it('renders multiple alerts in order', () => {
    const alerts = [
      createMockServiceAlert({ id: 'first', headerText: 'First Alert' }),
      createMockServiceAlert({ id: 'second', headerText: 'Second Alert' }),
    ];

    render(<AlertList alerts={alerts} />);

    const firstAlert = screen.getByText('First Alert');
    const secondAlert = screen.getByText('Second Alert');

    // Check that first alert comes before second in DOM
    expect(
      firstAlert.compareDocumentPosition(secondAlert) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
