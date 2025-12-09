'use client';

import { getRouteColor } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface RouteBadgeProps {
  routeId: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Colored badge displaying a subway route letter/number
 */
export function RouteBadge({ routeId, size = 'md', className }: RouteBadgeProps) {
  const color = getRouteColor(routeId);
  const displayId = routeId.replace(/X$/, ''); // Remove express suffix for display

  // Determine text color based on background brightness
  const textColor = ['#FCCC0A', '#6CBE45', '#A7A9AC'].includes(color)
    ? 'text-black'
    : 'text-white';

  const sizeClasses = {
    sm: 'w-5 h-5 text-xs',
    md: 'w-6 h-6 text-sm',
    lg: 'w-8 h-8 text-base',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold',
        sizeClasses[size],
        textColor,
        className
      )}
      style={{ backgroundColor: color }}
      title={`Route ${routeId}`}
    >
      {displayId}
    </span>
  );
}

/**
 * Display multiple route badges in a row
 */
export function RouteBadges({
  routes,
  size = 'sm',
  max = 5,
  className,
}: {
  routes: string[];
  size?: 'sm' | 'md' | 'lg';
  max?: number;
  className?: string;
}) {
  const displayed = routes.slice(0, max);
  const remaining = routes.length - max;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {displayed.map((route) => (
        <RouteBadge key={route} routeId={route} size={size} />
      ))}
      {remaining > 0 && (
        <span className="text-xs text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}
