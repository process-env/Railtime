'use client';

import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getRouteColor, SEVERITY_COLORS, ALERT_LIMITS } from '@/lib/constants';
import { getTextColorForBackground } from '@/lib/mta/format';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import type { ServiceAlert, AlertSeverity } from '@/types/mta';

interface AlertCardProps {
  alert: ServiceAlert;
  defaultExpanded?: boolean;
  className?: string;
}

const severityIcons: Record<AlertSeverity, typeof AlertTriangle> = {
  critical: AlertTriangle,
  warning: AlertCircle,
  info: Info,
};

export function AlertCard({ alert, defaultExpanded = false, className }: AlertCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const Icon = severityIcons[alert.severity];
  const colors = SEVERITY_COLORS[alert.severity];

  // Format time range
  const formatTimeRange = () => {
    if (!alert.activePeriods.length) return 'Ongoing';

    const period = alert.activePeriods[0];
    const start = new Date(period.start);
    const startStr = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    if (!period.end) return `Starting ${startStr}`;

    const end = new Date(period.end);
    const endStr = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    return `${startStr} - ${endStr}`;
  };

  // Sanitize HTML content before rendering
  const sanitizedDescription = sanitizeHtml(alert.descriptionHtml || alert.headerText);

  return (
    <Card className={cn('overflow-hidden transition-shadow hover:shadow-md', className)}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start gap-3">
          <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', colors.text)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant={colors.badge} className="capitalize">
                {alert.alertType || alert.severity}
              </Badge>
              {/* Route badges - circles */}
              {alert.affectedRoutes.slice(0, ALERT_LIMITS.CARD_ROUTES).map((route) => {
                const color = getRouteColor(route);
                const textColor = getTextColorForBackground(color);
                return (
                  <span
                    key={`${alert.id}-route-${route}`}
                    className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded-full"
                    style={{ backgroundColor: color, color: textColor }}
                  >
                    {route}
                  </span>
                );
              })}
              {alert.affectedRoutes.length > ALERT_LIMITS.CARD_ROUTES && (
                <span className="text-xs text-muted-foreground">
                  +{alert.affectedRoutes.length - ALERT_LIMITS.CARD_ROUTES} more
                </span>
              )}
            </div>
            <h3 className="font-medium text-sm leading-tight">{alert.headerText}</h3>
            <p className="text-xs text-muted-foreground mt-1">{formatTimeRange()}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="px-4 pb-4 pt-0">
          <div
            className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none mt-2 border-t pt-3"
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
          />
          {alert.affectedStopNames.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Affected Stations ({alert.affectedStopNames.length})
              </p>
              <p className="text-xs text-muted-foreground">
                {alert.affectedStopNames.slice(0, ALERT_LIMITS.CARD_STATIONS).join(', ')}
                {alert.affectedStopNames.length > ALERT_LIMITS.CARD_STATIONS &&
                  ` +${alert.affectedStopNames.length - ALERT_LIMITS.CARD_STATIONS} more`}
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
