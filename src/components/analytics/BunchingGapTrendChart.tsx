'use client';

import { useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp } from 'lucide-react';
import { useDailyRollups } from '@/hooks/use-analytics-data';

type Period = '7d' | '30d';

export function BunchingGapTrendChart() {
  const [period, setPeriod] = useState<Period>('7d');
  const days = period === '7d' ? 7 : 30;

  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const { data, loading } = useDailyRollups(from, to);

  const chartData = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];

    // Group by date, sum across routes
    const byDate = new Map<string, { bunching: number; gaps: number }>();
    for (const r of rollups) {
      const date = r.date?.split('#')[0]; // strip direction suffix
      if (!date) continue;
      const existing = byDate.get(date) ?? { bunching: 0, gaps: 0 };
      existing.bunching += r.totalBunching ?? 0;
      existing.gaps += r.totalGaps ?? 0;
      byDate.set(date, existing);
    }

    return Array.from(byDate.entries())
      .map(([date, vals]) => ({
        date,
        label: format(new Date(date + 'T12:00:00'), 'MMM d'),
        bunching: vals.bunching,
        gaps: vals.gaps,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Bunching & Gap Trends
        </CardTitle>
        <div className="flex gap-1">
          {(['7d', '30d'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
            No trend data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 11 }} />
              <YAxis className="text-xs" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="bunching"
                name="Bunching"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="gaps"
                name="Gaps"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
