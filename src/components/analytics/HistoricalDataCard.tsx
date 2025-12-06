'use client';

import { Database, Clock, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';

interface CollectionStats {
  totalSnapshots: number;
  totalArrivals: number;
  totalAlerts: number;
  lastCollection: string | null;
  lastStatus: string | null;
  dataRange: {
    from: string;
    to: string;
    hours: number;
  } | null;
}

interface HistoricalDataCardProps {
  stats: CollectionStats | null;
}

export function HistoricalDataCard({ stats }: HistoricalDataCardProps) {
  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <Card className="min-h-[200px]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Database className="h-4 w-4" />
          Data Collection
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stats ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">Snapshots</p>
                <p className="text-sm font-semibold">{formatNumber(stats.totalSnapshots)}</p>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">Arrivals</p>
                <p className="text-sm font-semibold">{formatNumber(stats.totalArrivals)}</p>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">Alerts</p>
                <p className="text-sm font-semibold">{formatNumber(stats.totalAlerts)}</p>
              </div>
            </div>

            {stats.lastCollection && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last collected {formatDistanceToNow(new Date(stats.lastCollection))} ago
                {stats.lastStatus && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      stats.lastStatus === 'success'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {stats.lastStatus}
                  </span>
                )}
              </div>
            )}

            {stats.dataRange && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                {stats.dataRange.hours}h of data collected
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Auto-collecting every 5 minutes
            </p>
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">No data collected yet</p>
            <p className="text-xs mt-1">Data collection runs every 5 minutes</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
