'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useDailyRollups } from '@/hooks/use-analytics-data';
import { getRouteColor } from '@/lib/constants';

interface AggregatedRoute {
  routeId: string;
  avgDelay: number;
  onTimePercent: number;
  totalTrips: number;
}

function RouteCircle({ routeId }: { routeId: string }) {
  const color = getRouteColor(routeId);
  return (
    <div
      className="flex items-center justify-center rounded-full shrink-0"
      style={{
        width: 36,
        height: 36,
        backgroundColor: color,
      }}
    >
      <span className="text-white text-sm font-bold leading-none">
        {routeId}
      </span>
    </div>
  );
}

function progressBarColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function formatDelay(seconds: number): string {
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)} min delay`;
}

function RouteRow({
  route,
  label,
  icon: Icon,
}: {
  route: AggregatedRoute;
  label: string;
  icon: typeof TrendingUp;
}) {
  const barColor = progressBarColor(route.onTimePercent);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <RouteCircle routeId={route.routeId} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{route.routeId} Train</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{route.onTimePercent.toFixed(1)}% on-time</span>
            <span className="text-muted-foreground/50">|</span>
            <span>{route.totalTrips} trips</span>
            <span className="text-muted-foreground/50">|</span>
            <span>{formatDelay(route.avgDelay)}</span>
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(route.onTimePercent, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function BestWorstRouteCard() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data, loading } = useDailyRollups(today, today);

  const { best, worst } = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];
    if (rollups.length === 0) return { best: null, worst: null };

    // Aggregate rollups by routeId (combining N+S directions)
    const byRoute = new Map<
      string,
      { totalDelay: number; delayCount: number; totalOnTime: number; onTimeCount: number; totalTrips: number }
    >();

    for (const r of rollups) {
      const existing = byRoute.get(r.routeId) ?? {
        totalDelay: 0,
        delayCount: 0,
        totalOnTime: 0,
        onTimeCount: 0,
        totalTrips: 0,
      };

      if (r.avgDelay != null) {
        existing.totalDelay += r.avgDelay;
        existing.delayCount += 1;
      }
      if (r.onTimePercent != null) {
        existing.totalOnTime += r.onTimePercent;
        existing.onTimeCount += 1;
      }
      if (r.totalTrips != null) {
        existing.totalTrips += r.totalTrips;
      }

      byRoute.set(r.routeId, existing);
    }

    // Convert to aggregated routes, filtering to those with on-time data
    const aggregated: AggregatedRoute[] = [];
    for (const [routeId, agg] of byRoute) {
      if (agg.onTimeCount === 0) continue;
      aggregated.push({
        routeId,
        avgDelay: agg.delayCount > 0 ? agg.totalDelay / agg.delayCount : 0,
        onTimePercent: agg.totalOnTime / agg.onTimeCount,
        totalTrips: agg.totalTrips,
      });
    }

    if (aggregated.length === 0) return { best: null, worst: null };

    // Sort by onTimePercent descending
    aggregated.sort((a, b) => b.onTimePercent - a.onTimePercent);

    return {
      best: aggregated[0],
      worst: aggregated.length > 1 ? aggregated[aggregated.length - 1] : null,
    };
  }, [data]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Best &amp; Worst Routes Today
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-[80px]" />
            <Skeleton className="h-[80px]" />
          </div>
        ) : best ? (
          <div className="space-y-4">
            <RouteRow route={best} label="Best Performer" icon={TrendingUp} />
            {worst && (
              <>
                <Separator />
                <RouteRow route={worst} label="Needs Improvement" icon={TrendingDown} />
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Collecting performance data...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
