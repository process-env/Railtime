'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3 } from 'lucide-react';
import { useDailyRollups } from '@/hooks/use-analytics-data';

function getBarColor(onTimePercent: number | null): string {
  if (onTimePercent == null) return '#6b7280';
  if (onTimePercent >= 80) return '#22c55e';
  if (onTimePercent >= 60) return '#eab308';
  return '#ef4444';
}

interface ChartDatum {
  routeId: string;
  trips: number;
  onTimePercent: number | null;
}

export function TripCompletionChart() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data, loading } = useDailyRollups(today, today);

  const chartData = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];
    if (rollups.length === 0) return [];

    // Aggregate by routeId (combine N+S directions)
    const byRoute = new Map<string, { trips: number; onTimeSum: number; onTimeCount: number }>();
    for (const r of rollups) {
      const existing = byRoute.get(r.routeId) ?? { trips: 0, onTimeSum: 0, onTimeCount: 0 };
      existing.trips += r.totalTrips ?? 0;
      if (r.onTimePercent != null) {
        existing.onTimeSum += r.onTimePercent;
        existing.onTimeCount++;
      }
      byRoute.set(r.routeId, existing);
    }

    return Array.from(byRoute.entries())
      .map(([routeId, { trips, onTimeSum, onTimeCount }]): ChartDatum => ({
        routeId,
        trips,
        onTimePercent: onTimeCount > 0 ? Math.round((onTimeSum / onTimeCount) * 10) / 10 : null,
      }))
      .filter(d => d.trips > 0)
      .sort((a, b) => b.trips - a.trips);
  }, [data]);

  const totalTrips = useMemo(() => chartData.reduce((sum, d) => sum + d.trips, 0), [chartData]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Trip Volume by Route
          {totalTrips > 0 && (
            <span className="ml-auto text-xs text-muted-foreground font-normal">
              {totalTrips.toLocaleString()} trips today
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">Trip Intelligence</p>
            <p className="text-sm text-center max-w-sm">
              Collecting trip lifecycle data. Trip volumes will appear here as data accumulates.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="routeId"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
              />
              <YAxis
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                width={45}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
                itemStyle={{ color: '#fff' }}
                formatter={(value: number, _name: string, entry: { payload?: ChartDatum }) => {
                  const otp = entry.payload?.onTimePercent;
                  return [`${value} trips${otp != null ? ` (${otp}% on-time)` : ''}`, 'Volume'];
                }}
              />
              <Bar dataKey="trips" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.routeId} fill={getBarColor(entry.onTimePercent)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
