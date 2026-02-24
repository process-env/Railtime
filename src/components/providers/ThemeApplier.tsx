'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';

/**
 * Reads the persisted theme preference from the UI store and applies
 * the corresponding `dark` or `light` class to `<html>`.
 *
 * For `system`, it follows the OS preference via `prefers-color-scheme`.
 */
export function ThemeApplier() {
  const theme = useUIStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;

    function apply(resolved: 'dark' | 'light') {
      root.classList.remove('dark', 'light');
      root.classList.add(resolved);
    }

    if (theme === 'dark' || theme === 'light') {
      apply(theme);
      return;
    }

    // theme === 'system' — match OS preference
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    apply(mql.matches ? 'dark' : 'light');

    const onChange = (e: MediaQueryListEvent) => {
      apply(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  return null;
}
