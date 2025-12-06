'use client';

import { cn } from '@/lib/utils';
import { useAlerts } from '@/hooks/use-alerts';
import { SEVERITY_COLORS } from '@/lib/constants';

interface AlertBadgeProps {
  className?: string;
  showZero?: boolean;
}

export function AlertBadge({ className, showZero = false }: AlertBadgeProps) {
  const { counts } = useAlerts();

  const totalCount = counts.critical + counts.warning + counts.info;

  if (totalCount === 0 && !showZero) return null;

  // Determine color based on highest severity present
  const severity =
    counts.critical > 0 ? 'critical' : counts.warning > 0 ? 'warning' : 'info';
  const colors = SEVERITY_COLORS[severity];

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-bold rounded-full',
        colors.bg,
        colors.textOnBg,
        className
      )}
    >
      {totalCount}
    </span>
  );
}
