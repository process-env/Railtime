'use client';

import { useState, useMemo } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnomalyFeed, type AnomalyEvent } from '@/hooks/use-anomaly-feed';
import { ROUTE_COLORS } from '@/lib/constants';

function parseEvent(event: AnomalyEvent) {
  const parts = event.pk.split('#');
  const type = parts[0] as 'BUNCH' | 'GAP' | 'DELAY';
  const routeId = parts[1] ?? '?';
  const direction = parts[2] ?? '';
  return { type, routeId, direction };
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1m ago';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  BUNCH: { bg: 'bg-orange-500/15', text: 'text-orange-600 dark:text-orange-400' },
  GAP: { bg: 'bg-red-500/15', text: 'text-red-600 dark:text-red-400' },
  DELAY: { bg: 'bg-yellow-500/15', text: 'text-yellow-600 dark:text-yellow-400' },
};

export function AnomalyFeed() {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [routeFilter, setRouteFilter] = useState<string>('all');

  const { data, isLoading, isRefetching } = useAnomalyFeed({
    type: typeFilter !== 'all' ? typeFilter as 'BUNCH' | 'GAP' | 'DELAY' : undefined,
    routeId: routeFilter !== 'all' ? routeFilter : undefined,
    limit: 100,
  });

  const events = data?.events ?? [];

  // Extract unique route IDs from current events for filter dropdown
  const availableRoutes = useMemo(() => {
    const items = data?.events ?? [];
    const routes = new Set<string>();
    for (const e of items) {
      const { routeId } = parseEvent(e);
      routes.add(routeId);
    }
    return Array.from(routes).sort();
  }, [data]);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Live Anomaly Feed
            {isRefetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {events.length} events
          </Badge>
        </div>
        <div className="flex gap-2 mt-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="BUNCH">Bunching</SelectItem>
              <SelectItem value="GAP">Gaps</SelectItem>
              <SelectItem value="DELAY">Delays</SelectItem>
            </SelectContent>
          </Select>
          <Select value={routeFilter} onValueChange={setRouteFilter}>
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue placeholder="Route" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Routes</SelectItem>
              {availableRoutes.map(r => (
                <SelectItem key={r} value={r}>{r} Train</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No anomalies detected</p>
            <p className="text-xs text-muted-foreground/70">System operating normally</p>
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[350px]">
            <div className="divide-y divide-border">
              {events.map((event, i) => {
                const { type, routeId, direction } = parseEvent(event);
                const style = TYPE_STYLES[type] ?? TYPE_STYLES.DELAY;
                const routeColor = ROUTE_COLORS[routeId] ?? '#888';

                return (
                  <div key={`${event.pk}-${event.timestamp}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                    {/* Route pill */}
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: routeColor }}
                    >
                      {routeId}
                    </div>
                    {/* Type badge + description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text}`}>
                          {type}
                        </span>
                        {direction && (
                          <span className="text-[10px] text-muted-foreground">{direction}B</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {event.description ?? (
                          type === 'DELAY' && event.delaySeconds
                            ? `${Math.round(event.delaySeconds / 60)}m delay`
                            : `${type.toLowerCase()} event detected`
                        )}
                      </p>
                    </div>
                    {/* Timestamp */}
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{formatTimestamp(event.timestamp)}</p>
                      <p className="text-[10px] text-muted-foreground">{relativeTime(event.timestamp)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
