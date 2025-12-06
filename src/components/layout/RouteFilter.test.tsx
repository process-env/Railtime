import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteFilter } from './RouteFilter';
import { useUIStore } from '@/stores';

describe('RouteFilter', () => {
  beforeEach(() => {
    useUIStore.setState({
      selectedRouteIds: [],
      sidebarOpen: false,
      selectedTrainId: null,
    });
  });

  it('renders all subway route buttons', () => {
    render(<RouteFilter />);

    // Check some routes are rendered
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('selects route when clicked', () => {
    render(<RouteFilter />);

    const routeButton = screen.getByText('A');
    fireEvent.click(routeButton);

    expect(useUIStore.getState().selectedRouteIds).toContain('A');
  });

  it('deselects route when clicked again', () => {
    useUIStore.setState({ selectedRouteIds: ['A'] });

    render(<RouteFilter />);

    const routeButton = screen.getByText('A');
    fireEvent.click(routeButton);

    expect(useUIStore.getState().selectedRouteIds).not.toContain('A');
  });

  it('applies selected styling to active routes', () => {
    useUIStore.setState({ selectedRouteIds: ['A'] });

    const { container } = render(<RouteFilter />);

    // Selected route should have ring styling
    const selectedButton = screen.getByText('A').closest('button');
    expect(selectedButton?.className).toContain('ring-2');
  });

  it('shows clear button when routes are selected', () => {
    useUIStore.setState({ selectedRouteIds: ['A', 'C'] });

    render(<RouteFilter />);

    expect(screen.getByText('Clear filters (2)')).toBeInTheDocument();
  });

  it('hides clear button when no routes selected', () => {
    render(<RouteFilter />);
    expect(screen.queryByText(/Clear filters/)).not.toBeInTheDocument();
  });

  it('clears all filters when clear button clicked', () => {
    useUIStore.setState({ selectedRouteIds: ['A', 'C', 'E'] });

    render(<RouteFilter />);

    const clearButton = screen.getByText('Clear filters (3)');
    fireEvent.click(clearButton);

    expect(useUIStore.getState().selectedRouteIds).toHaveLength(0);
  });

  it('supports multiple route selection', () => {
    render(<RouteFilter />);

    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('C'));
    fireEvent.click(screen.getByText('E'));

    const selected = useUIStore.getState().selectedRouteIds;
    expect(selected).toContain('A');
    expect(selected).toContain('C');
    expect(selected).toContain('E');
  });

  it('renders route buttons with correct colors', () => {
    render(<RouteFilter />);

    // A train should have blue background
    const aButton = screen.getByText('A').closest('button');
    expect(aButton?.style.backgroundColor).toBeTruthy();
  });

  it('uses black text for yellow routes', () => {
    render(<RouteFilter />);

    // N train is yellow with black text
    const nButton = screen.getByText('N').closest('button');
    expect(nButton?.style.color).toBe('rgb(0, 0, 0)');
  });
});
