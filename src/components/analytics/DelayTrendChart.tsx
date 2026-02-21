'use client';

import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingDown } from 'lucide-react';
import { useDailyRollups } from '@/hooks/use-analytics-data';
import { getRouteColor } from '@/lib/constants';

type TimeRange = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<TimeRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function DelayTrendChart() {
  const [range, setRange] = useState<TimeRange>('7d');

  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), RANGE_DAYS[range]), 'yyyy-MM-dd');

  const { data, loading } = useDailyRollups(from, to);

  const { chartData, routeIds } = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];
    if (rollups.length === 0) return { chartData: [], routeIds: [] };

    // Group by date
    const byDate = new Map<string, Record<string, number>>();
    const routes = new Set<string>();

    for (const r of rollups) {
      routes.add(r.routeId);
      const entry = byDate.get(r.date) ?? {};
      if (r.avgDelay != null) {
        entry[r.routeId] = Math.round(r.avgDelay * 10) / 10;
      }
      byDate.set(r.date, entry);
    }

    const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
    const cd = sorted.map(([date, values]) => ({
      date,
      dateLabel: format(new Date(date + 'T00:00:00'), 'MMM d'),
      ...values,
    }));

    return { chartData: cd, routeIds: [...routes].sort() };
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingDown className="h-4 w-4" />
          Delay Trends
        </CardTitle>
        <div className="flex gap-1">
          {(['7d', '30d', '90d'] as TimeRange[]).map((r) => (
            <Button
              key={r}
              variant={range === r ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            <p>No historical data available yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="dateLabel"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                label={{
                  value: 'Avg Delay (s)',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#888', fontSize: 11 },
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
                formatter={(value: number) => [
                  `${value}s`,
                  'Avg Delay',
                ]}
              />
              <Legend />
              {routeIds.map((routeId) => (
                <Line
                  key={routeId}
                  type="monotone"
                  dataKey={routeId}
                  name={routeId}
                  stroke={getRouteColor(routeId)}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
