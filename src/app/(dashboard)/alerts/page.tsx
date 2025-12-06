'use client';

import { useMemo } from 'react';
import { RefreshCw, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertList } from '@/components/alerts';
import { useAlerts } from '@/hooks/use-alerts';
import { SEVERITY_COLORS } from '@/lib/constants';
import type { ServiceAlert } from '@/types/mta';

// Single-pass grouping of alerts by severity
function groupAlertsBySeverity(alerts: ServiceAlert[]) {
  return alerts.reduce(
    (acc, alert) => {
      acc[alert.severity].push(alert);
      return acc;
    },
    {
      critical: [] as ServiceAlert[],
      warning: [] as ServiceAlert[],
      info: [] as ServiceAlert[],
    }
  );
}

export default function AlertsPage() {
  // Use the new hook interface - alerts and counts come directly from the hook
  const { alerts: activeAlerts, counts, isLoading, error, refetch } = useAlerts();

  // Single-pass grouping instead of multiple filter calls
  const {
    critical: criticalAlerts,
    warning: warningAlerts,
    info: infoAlerts,
  } = useMemo(() => groupAlertsBySeverity(activeAlerts), [activeAlerts]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <p className="text-destructive">Error: {error}</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto overflow-x-hidden h-full w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Service Alerts</h1>
          <p className="text-muted-foreground">
            Active service disruptions and advisories
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3 p-4 rounded-lg border bg-card transition-shadow hover:shadow-md">
          <div className={`p-2 rounded-full ${SEVERITY_COLORS.critical.bgLight}`}>
            <AlertTriangle
              className={`h-5 w-5 ${SEVERITY_COLORS.critical.text}`}
            />
          </div>
          <div>
            <p className="text-2xl font-bold">{counts.critical}</p>
            <p className="text-xs text-muted-foreground">Critical</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-lg border bg-card transition-shadow hover:shadow-md">
          <div className={`p-2 rounded-full ${SEVERITY_COLORS.warning.bgLight}`}>
            <AlertCircle
              className={`h-5 w-5 ${SEVERITY_COLORS.warning.text}`}
            />
          </div>
          <div>
            <p className="text-2xl font-bold">{counts.warning}</p>
            <p className="text-xs text-muted-foreground">Warnings</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-lg border bg-card transition-shadow hover:shadow-md">
          <div className={`p-2 rounded-full ${SEVERITY_COLORS.info.bgLight}`}>
            <Info className={`h-5 w-5 ${SEVERITY_COLORS.info.text}`} />
          </div>
          <div>
            <p className="text-2xl font-bold">{counts.info}</p>
            <p className="text-xs text-muted-foreground">Info</p>
          </div>
        </div>
      </div>

      {/* Alert Tabs */}
      <div>
        {isLoading && activeAlerts.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All ({activeAlerts.length})</TabsTrigger>
              <TabsTrigger
                value="critical"
                className={SEVERITY_COLORS.critical.text}
              >
                Critical ({criticalAlerts.length})
              </TabsTrigger>
              <TabsTrigger
                value="warning"
                className={SEVERITY_COLORS.warning.text}
              >
                Warnings ({warningAlerts.length})
              </TabsTrigger>
              <TabsTrigger value="info" className={SEVERITY_COLORS.info.text}>
                Info ({infoAlerts.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <AlertList alerts={activeAlerts} defaultExpanded />
            </TabsContent>

            <TabsContent value="critical" className="mt-4">
              <AlertList
                alerts={criticalAlerts}
                emptyMessage="No critical alerts"
                defaultExpanded
              />
            </TabsContent>

            <TabsContent value="warning" className="mt-4">
              <AlertList
                alerts={warningAlerts}
                emptyMessage="No warning alerts"
                defaultExpanded
              />
            </TabsContent>

            <TabsContent value="info" className="mt-4">
              <AlertList
                alerts={infoAlerts}
                emptyMessage="No info alerts"
                defaultExpanded
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
