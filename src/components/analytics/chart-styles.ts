import type { CSSProperties } from 'react';

/**
 * Shared tooltip styles for Recharts chart components.
 * Keeps dark-themed tooltips consistent across all analytics charts.
 */
export const CHART_TOOLTIP_STYLE: {
  content: CSSProperties;
  label: CSSProperties;
  item: CSSProperties;
} = {
  content: {
    backgroundColor: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: '8px',
  },
  label: {
    color: '#fff',
  },
  item: {
    color: '#fff',
  },
};
