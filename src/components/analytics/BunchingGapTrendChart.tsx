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
import type { RollupDataProp } from '@/lib/graphql/types';

type Period = '7d' | '30d';

interface BunchingGapTrendChartProps {
  rollupData?: RollupDataProp;
}

export function BunchingGapTrendChart({ rollupData: sharedRollup }: BunchingGapTrendChartProps) {
  const [period, setPeriod] = useState<Period>('7d');

  // Filter shared 30-day data to selected period
  const cutoff = useMemo(
    () => format(subDays(new Date(), period === '7d' ? 7 : 30), 'yyyy-MM-dd'),
    [period]
  );

  const data = useMemo(() => {
    if (!sharedRollup?.data) return sharedRollup?.data;
    if (period === '30d') return sharedRollup.data; // Full shared data
    return {
      getDailyRollups: sharedRollup.data.getDailyRollups.filter(
        (r) => r.date.split('#')[0] >= cutoff
      ),
    };
  }, [sharedRollup?.data, period, cutoff]);

  const loading = sharedRollup?.loading ?? false;

  const chartData = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];

    // Group by date, count distinct routes affected (not raw instance totals)
    const byDate = new Map<string, { bunchRoutes: Set<string>; gapRoutes: Set<string> }>();
    for (const r of rollups) {
      const date = r.date?.split('#')[0]; // strip direction suffix
      if (!date) continue;
      const existing = byDate.get(date) ?? { bunchRoutes: new Set(), gapRoutes: new Set() };
      if ((r.totalBunching ?? 0) > 0) existing.bunchRoutes.add(r.routeId);
      if ((r.totalGaps ?? 0) > 0) existing.gapRoutes.add(r.routeId);
      byDate.set(date, existing);
    }

    return Array.from(byDate.entries())
      .map(([date, vals]) => ({
        date,
        label: format(new Date(date + 'T12:00:00'), 'MMM d'),
        bunching: vals.bunchRoutes.size,
        gaps: vals.gapRoutes.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Routes with Bunching / Gaps
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
              <YAxis className="text-xs" tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                wrapperStyle={{ zIndex: 50 }}
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#fff' }}
                formatter={(value: number, name: string) => [`${value} routes`, name]}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="bunching"
                name="Bunching Routes"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="gaps"
                name="Gap Routes"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
