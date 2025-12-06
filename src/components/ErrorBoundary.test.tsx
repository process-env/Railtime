import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, MapErrorFallback, ChartErrorFallback } from './ErrorBoundary';

// Component that throws an error
function ThrowError({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
}

describe('ErrorBoundary', () => {
  // Suppress console.error for cleaner test output
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders error UI when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows error message in UI', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  it('renders Try again button', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('calls onReset when Try again clicked', () => {
    const onReset = vi.fn();

    render(
      <ErrorBoundary onReset={onReset}>
        <ThrowError />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByText('Try again'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('logs error to console', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalled();
  });
});

describe('MapErrorFallback', () => {
  it('renders map error message', () => {
    render(<MapErrorFallback />);
    expect(screen.getByText('Map failed to load')).toBeInTheDocument();
  });

  it('renders network issue explanation', () => {
    render(<MapErrorFallback />);
    expect(
      screen.getByText(/There was a problem loading the subway map/)
    ).toBeInTheDocument();
  });

  it('renders Reload Map button when onRetry provided', () => {
    render(<MapErrorFallback onRetry={() => {}} />);
    expect(screen.getByText('Reload Map')).toBeInTheDocument();
  });

  it('does not render button when onRetry not provided', () => {
    render(<MapErrorFallback />);
    expect(screen.queryByText('Reload Map')).not.toBeInTheDocument();
  });

  it('calls onRetry when button clicked', () => {
    const onRetry = vi.fn();
    render(<MapErrorFallback onRetry={onRetry} />);

    fireEvent.click(screen.getByText('Reload Map'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ChartErrorFallback', () => {
  it('renders chart error message', () => {
    render(<ChartErrorFallback />);
    expect(screen.getByText('Failed to load chart')).toBeInTheDocument();
  });

  it('has correct height class', () => {
    const { container } = render(<ChartErrorFallback />);
    expect(container.querySelector('.h-\\[300px\\]')).toBeInTheDocument();
  });
});
