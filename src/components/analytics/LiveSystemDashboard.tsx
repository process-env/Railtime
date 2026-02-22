'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Radio, Train } from 'lucide-react';

interface FeedStatusItem {
  feedId: string;
  lastPoll: string;
  tripCount: number;
  status: 'healthy' | 'stale' | 'error';
}

interface LiveSystemDashboardProps {
  totalTrains: number;
  feedStatus: FeedStatusItem[];
  alertCount: number;
  loading?: boolean;
}

function statusBadgeVariant(status: FeedStatusItem['status']) {
  switch (status) {
    case 'healthy':
      return 'default' as const;
    case 'stale':
      return 'secondary' as const;
    case 'error':
      return 'destructive' as const;
  }
}

export function LiveSystemDashboard({
  totalTrains,
  feedStatus,
  alertCount,
  loading = false,
}: LiveSystemDashboardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Live System Status
          </CardTitle>
          <Badge variant="default" className="flex items-center gap-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            {loading ? 'Connecting...' : 'Live'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-[200px]" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Train className="h-5 w-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{totalTrains}</p>
                <p className="text-xs text-muted-foreground">Active Trains</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Activity className="h-5 w-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{feedStatus.length}</p>
                <p className="text-xs text-muted-foreground">Feed Groups</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Radio className="h-5 w-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{alertCount}</p>
                <p className="text-xs text-muted-foreground">Active Alerts</p>
              </div>
            </div>
            {/* Feed group breakdown */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Feed Groups</p>
              {feedStatus.map((fg) => (
                <div key={fg.feedId} className="flex items-center justify-between p-2 rounded bg-muted/30">
                  <span className="text-sm font-medium">{fg.feedId}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{fg.tripCount} trains</span>
                    <Badge
                      variant={statusBadgeVariant(fg.status)}
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
