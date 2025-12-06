import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppSidebar } from './AppSidebar';
import { useUIStore, useAlertsStore } from '@/stores';
import { SidebarProvider } from '@/components/ui/sidebar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock window.matchMedia for SidebarProvider's useMobile hook
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/map'),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock SubwayMapModal to avoid PDF loading issues
vi.mock('./SubwayMapModal', () => ({
  SubwayMapModal: () => <button>Subway Map</button>,
}));

// Create wrapper with required providers
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen>
        {children}
      </SidebarProvider>
    </QueryClientProvider>
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    useUIStore.setState({
      selectedRouteIds: [],
      sidebarOpen: false,
      selectedTrainId: null,
    });
    useAlertsStore.setState({
      alerts: [],
      lastFetch: null,
      isLoading: false,
      error: null,
      dismissedIds: new Set(),
    });
  });

  it('renders app title', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    expect(screen.getByText('MTA Tracker')).toBeInTheDocument();
  });

  it('renders Live Map navigation link', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    expect(screen.getByText('Live Map')).toBeInTheDocument();
  });

  it('renders Analytics navigation link', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    expect(screen.getByText('Analytics')).toBeInTheDocument();
  });

  it('renders Stations navigation link', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    expect(screen.getByText('Stations')).toBeInTheDocument();
  });

  it('renders Alerts navigation link', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    expect(screen.getByText('Alerts')).toBeInTheDocument();
  });

  it('renders navigation links with correct hrefs', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });

    // Check href attributes
    const mapLink = screen.getByRole('link', { name: /Live Map/i });
    expect(mapLink).toHaveAttribute('href', '/map');

    const analyticsLink = screen.getByRole('link', { name: /Analytics/i });
    expect(analyticsLink).toHaveAttribute('href', '/analytics');
  });

  it('renders Filter Routes section when on map page', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    expect(screen.getByText('Filter Routes')).toBeInTheDocument();
  });

  it('renders RouteFilter component when on map page', () => {
    render(<AppSidebar />, { wrapper: TestWrapper });
    // RouteFilter renders route buttons
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('shows alert badge when there are alerts', () => {
    useAlertsStore.setState({
      alerts: [
        {
          id: '1',
          header: 'Test Alert',
          description: 'Test',
          createdAt: new Date().toISOString(),
          affectedRoutes: ['A'],
        },
      ],
      lastFetch: Date.now(),
      isLoading: false,
      error: null,
      dismissedIds: new Set(),
    });

    render(<AppSidebar />, { wrapper: TestWrapper });
    // Alert count should show in badge
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
