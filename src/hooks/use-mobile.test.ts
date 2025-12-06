import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './use-mobile';

describe('useIsMobile', () => {
  const originalInnerWidth = window.innerWidth;
  let matchMediaListeners: Array<(e: { matches: boolean }) => void> = [];

  beforeEach(() => {
    matchMediaListeners = [];

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: window.innerWidth < 768,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === 'change') {
            matchMediaListeners.push(listener);
          }
        }),
        removeEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === 'change') {
            matchMediaListeners = matchMediaListeners.filter((l) => l !== listener);
          }
        }),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: originalInnerWidth,
    });
    matchMediaListeners = [];
  });

  it('returns false initially (undefined coerced to false)', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 });

    const { result } = renderHook(() => useIsMobile());

    // After effect runs, should be false for desktop width
    expect(result.current).toBe(false);
  });

  it('returns true for mobile width', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it('returns false for desktop width', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it('returns true at breakpoint boundary (767px)', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 767 });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it('returns false at breakpoint (768px)', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 768 });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it('updates when window resizes', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 });

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate resize to mobile
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 });
      matchMediaListeners.forEach((listener) => listener({ matches: true }));
    });

    expect(result.current).toBe(true);
  });

  it('cleans up event listener on unmount', () => {
    // Track removeEventListener calls
    const removeListenerCalls: string[] = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: window.innerWidth < 768,
        media: query,
        addEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === 'change') {
            matchMediaListeners.push(listener);
          }
        }),
        removeEventListener: vi.fn((event: string) => {
          removeListenerCalls.push(event);
        }),
      })),
    });

    const { unmount } = renderHook(() => useIsMobile());

    unmount();

    expect(removeListenerCalls).toContain('change');
  });
});
