'use client';

import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp } from 'lucide-react';
import { useDailyRollups } from '@/hooks/use-analytics-data';

interface ChartDatum {
  date: string;
  trips: number;
  onTimePercent: number | null;
}

export function ArrivalsTimelineChart() {
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  const { data: rollupData, loading } = useDailyRollups(from, to);

  const chartData = useMemo<ChartDatum[]>(() => {
    const rollups = rollupData?.getDailyRollups ?? [];
    if (rollups.length === 0) return [];

    // Group by date (date field may contain "date#route" format)
    const byDate = new Map<string, { trips: number; onTimeSum: number; onTimeCount: number }>();
    for (const r of rollups) {
      const dateKey = r.date?.split('#')[0] ?? r.date;
      const existing = byDate.get(dateKey) ?? { trips: 0, onTimeSum: 0, onTimeCount: 0 };
      existing.trips += r.totalTrips ?? 0;
      if (r.onTimePercent != null) {
        existing.onTimeSum += r.onTimePercent;
        existing.onTimeCount++;
      }
      byDate.set(dateKey, existing);
    }

    return Array.from(byDate.entries())
      .map(([dateStr, { trips, onTimeSum, onTimeCount }]) => ({
        date: format(new Date(dateStr + 'T12:00:00'), 'MMM d'),
        trips,
        onTimePercent: onTimeCount > 0 ? Math.round((onTimeSum / onTimeCount) * 10) / 10 : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [rollupData]);

  const hasData = chartData.length > 0 && chartData.some((d) => d.trips > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          7-Day Trip Trends
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : !hasData ? (
          <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm">No rollup data available for the last 7 days</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="date"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 12 }}
              />
              <YAxis
                yAxisId="left"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 12 }}
                label={{ value: 'Trips', angle: -90, position: 'insideLeft', fill: '#888', fontSize: 12 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 12 }}
                domain={[0, 100]}
                label={{ value: 'On-Time %', angle: 90, position: 'insideRight', fill: '#888', fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#fff',
                }}
                labelStyle={{ color: '#fff' }}
              />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="trips"
                fill="#06b6d4"
                radius={[4, 4, 0, 0]}
                name="Trip Volume"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="onTimePercent"
                stroke="#a855f7"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                name="On-Time %"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
