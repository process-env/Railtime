'use client';

import { AlertCard } from './AlertCard';
import { cn } from '@/lib/utils';
import type { ServiceAlert } from '@/types/mta';

interface AlertListProps {
  alerts: ServiceAlert[];
  emptyMessage?: string;
  className?: string;
  defaultExpanded?: boolean;
}

export function AlertList({
  alerts,
  emptyMessage = 'No active service alerts',
  className,
  defaultExpanded = false,
}: AlertListProps) {
  if (alerts.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
        <div className="text-4xl mb-3">✓</div>
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} defaultExpanded={defaultExpanded} />
      ))}
    </div>
  );
}
