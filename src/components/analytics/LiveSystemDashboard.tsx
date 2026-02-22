'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Radio, Train } from 'lucide-react';
import { useSystemHealth } from '@/hooks/use-analytics-data';

export function LiveSystemDashboard() {
  const { data, loading } = useSystemHealth();
  const health = data?.getLatestSystemHealth;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Live System Status
          </CardTitle>
          <Badge variant={health ? 'default' : 'secondary'} className="flex items-center gap-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            {loading ? 'Connecting...' : 'Live'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!health ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Waiting for system health data...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Train className="h-5 w-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{health.activeTrains}</p>
                <p className="text-xs text-muted-foreground">Active Trains</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Activity className="h-5 w-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{health.feedGroups.length}</p>
                <p className="text-xs text-muted-foreground">Feed Groups</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Radio className="h-5 w-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{health.alertCount}</p>
                <p className="text-xs text-muted-foreground">Active Alerts</p>
              </div>
            </div>
            {/* Feed group breakdown */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Feed Groups</p>
              {health.feedGroups.map((fg) => (
                <div key={fg.feedGroupId} className="flex items-center justify-between p-2 rounded bg-muted/30">
                  <span className="text-sm font-medium">{fg.feedGroupId}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{fg.trainCount ?? 0} trains</span>
                    {fg.latencyMs != null && (
                      <span className="text-xs text-muted-foreground">{fg.latencyMs}ms</span>
                    )}
                    <Badge
                      variant={fg.status === 'ok' || fg.status === 'success' ? 'default' : 'destructive'}
                      className="text-xs"
                    >
                      {fg.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
