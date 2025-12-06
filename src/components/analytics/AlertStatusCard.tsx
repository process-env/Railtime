'use client';

import Link from 'next/link';
import { AlertTriangle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAlerts } from '@/hooks/use-alerts';

export function AlertStatusCard() {
  const { alerts: activeAlerts, counts } = useAlerts();

  const total = counts.critical + counts.warning + counts.info;
  const recentAlerts = activeAlerts.slice(0, 3);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Service Alerts</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/alerts" className="flex items-center gap-1">
            View All
            <ExternalLink className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-xl font-bold">{counts.critical}</p>
              <p className="text-xs text-muted-foreground">Critical</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <div>
              <p className="text-xl font-bold">{counts.warning}</p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-xl font-bold">{counts.info}</p>
              <p className="text-xs text-muted-foreground">Info</p>
            </div>
          </div>
        </div>

        {/* Recent Alerts */}
        {total > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Recent Alerts
            </p>
            {recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-2 text-sm p-2 rounded-md bg-muted/50"
              >
                {alert.severity === 'critical' && (
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                )}
                {alert.severity === 'warning' && (
                  <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                )}
                {alert.severity === 'info' && (
                  <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                )}
                <p className="line-clamp-2">{alert.headerText}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground text-sm border-t">
            No active service alerts
          </div>
        )}
      </CardContent>
    </Card>
  );
}
