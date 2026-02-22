'use client';

import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3 } from 'lucide-react';
import { useDailyRollups } from '@/hooks/use-analytics-data';
import { getRouteColor } from '@/lib/constants';

interface RouteSummary {
  routeId: string;
  avgDelay: number | null;
  onTimePercent: number | null;
  avgHeadway: number | null;
  medianHeadway: number | null;
  peakTrainCount: number | null;
  totalAlerts: number;
  totalBunching: number;
  totalGaps: number;
  days: number;
}

export function RoutePerformanceTable() {
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const { data, loading } = useDailyRollups(from, to);

  const rows = useMemo<RouteSummary[]>(() => {
    const rollups = data?.getDailyRollups ?? [];
    if (rollups.length === 0) return [];

    const byRoute = new Map<string, typeof rollups>();
    for (const r of rollups) {
      const arr = byRoute.get(r.routeId) ?? [];
      arr.push(r);
      byRoute.set(r.routeId, arr);
    }

    const summaries: RouteSummary[] = [];
    for (const [routeId, records] of byRoute) {
      const delays = records
        .map((r) => r.avgDelay)
        .filter((d): d is number => d != null);
      const onTimes = records
        .map((r) => r.onTimePercent)
        .filter((d): d is number => d != null);
      const headways = records
        .map((r) => r.avgHeadway)
        .filter((d): d is number => d != null);
      const medianHeadways = records
        .map((r) => r.medianHeadway)
        .filter((d): d is number => d != null);
      const peaks = records
        .map((r) => r.peakTrainCount)
        .filter((d): d is number => d != null);

      // Count unique dates (don't count N and S as separate days)
      const uniqueDates = new Set(records.map((r) => r.date.split('#')[0]));

      summaries.push({
        routeId,
        avgDelay:
          delays.length > 0
            ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
            : null,
        onTimePercent:
          onTimes.length > 0
            ? Math.round((onTimes.reduce((a, b) => a + b, 0) / onTimes.length) * 10) / 10
            : null,
        avgHeadway:
          headways.length > 0
            ? Math.round(headways.reduce((a, b) => a + b, 0) / headways.length)
            : null,
        medianHeadway:
          medianHeadways.length > 0
            ? Math.round(medianHeadways.reduce((a, b) => a + b, 0) / medianHeadways.length)
            : null,
        peakTrainCount:
          peaks.length > 0 ? Math.max(...peaks) : null,
        totalAlerts: records.reduce(
          (sum, r) => sum + (r.totalAlerts ?? 0),
          0,
        ),
        totalBunching: records.reduce(
          (sum, r) => sum + (r.totalBunching ?? 0),
          0,
        ),
        totalGaps: records.reduce(
          (sum, r) => sum + (r.totalGaps ?? 0),
          0,
        ),
        days: uniqueDates.size,
      });
    }

    return summaries.sort((a, b) => a.routeId.localeCompare(b.routeId));
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Route Performance (7-day avg)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : rows.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            <p>No performance data available yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Route</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">On-Time %</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Avg Delay</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Headway</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Med. Headway</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Peak Trains</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Bunching</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Gaps</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Alerts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.routeId} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: getRouteColor(row.routeId) }}
                      >
                        {row.routeId}
                      </span>
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.onTimePercent != null ? (
                        <span
                          className={
                            row.onTimePercent >= 80
                              ? 'text-green-400'
                              : row.onTimePercent >= 60
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }
                        >
                          {row.onTimePercent}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.avgDelay != null
                        ? `${row.avgDelay}s`
                        : '-'}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.avgHeadway != null
                        ? `${Math.floor(row.avgHeadway / 60)}m ${row.avgHeadway % 60}s`
                        : '-'}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.medianHeadway != null
                        ? `${Math.floor(row.medianHeadway / 60)}m ${row.medianHeadway % 60}s`
                        : '-'}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.peakTrainCount ?? '-'}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.totalBunching > 0 ? (
                        <span className="text-orange-400">{row.totalBunching}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.totalGaps > 0 ? (
                        <span className="text-red-400">{row.totalGaps}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.totalAlerts > 0 ? (
                        <span className="text-yellow-400">{row.totalAlerts}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
