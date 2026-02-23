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
import type { RollupDataProp } from '@/lib/graphql/types';

type TimeRange = '7d' | '30d' | '90d';

interface DelayTrendChartProps {
  rollupData?: RollupDataProp;
}

export function DelayTrendChart({ rollupData: sharedRollup }: DelayTrendChartProps) {
  const [range, setRange] = useState<TimeRange>('7d');

  // For 90d, we need a dedicated query since shared data only covers 30 days.
  // Pass empty strings when not in 90d mode so Apollo's skip logic prevents the request.
  const ninetyDayFrom = useMemo(
    () => (range === '90d' ? format(subDays(new Date(), 90), 'yyyy-MM-dd') : ''),
    [range]
  );
  const ninetyDayTo = useMemo(
    () => (range === '90d' ? format(new Date(), 'yyyy-MM-dd') : ''),
    [range]
  );
  const { data: extendedData, loading: extendedLoading } = useDailyRollups(
    ninetyDayFrom,
    ninetyDayTo,
  );

  // For 7d/30d, filter from the shared 30-day data; for 90d, use the dedicated query
  const { data, loading } = useMemo(() => {
    if (range === '90d') {
      return { data: extendedData, loading: extendedLoading };
    }
    if (!sharedRollup?.data) {
      return { data: sharedRollup?.data, loading: sharedRollup?.loading ?? false };
    }
    if (range === '30d') {
      return { data: sharedRollup.data, loading: sharedRollup.loading };
    }
    // 7d: filter from shared 30-day data
    const cutoff = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    return {
      data: {
        getDailyRollups: sharedRollup.data.getDailyRollups.filter(
          (r) => r.date.split('#')[0] >= cutoff
        ),
      },
      loading: sharedRollup.loading,
    };
  }, [range, sharedRollup, extendedData, extendedLoading]);

  const { chartData, routeIds } = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];
    if (rollups.length === 0) return { chartData: [], routeIds: [] };

    // Group by date
    const byDate = new Map<string, Record<string, number>>();
    const routes = new Set<string>();

    for (const r of rollups) {
      const cleanDate = r.date.split('#')[0]; // Strip direction suffix
      routes.add(r.routeId);
      const entry = byDate.get(cleanDate) ?? {};
      if (r.avgDelay != null) {
        // Aggregate multiple direction records for same route+date
        const key = r.routeId;
        if (entry[key] != null) {
          entry[key] = (entry[key] + r.avgDelay) / 2; // Average N+S
        } else {
          entry[key] = Math.round(r.avgDelay * 10) / 10;
        }
      }
      byDate.set(cleanDate, entry);
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
                tickFormatter={(value: number) => `${Math.round(value / 60)}`}
                label={{
                  value: 'Avg Delay (min)',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#888', fontSize: 11 },
                }}
              />
              <Tooltip
                wrapperStyle={{ zIndex: 50 }}
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
                formatter={(value: number, name: string) => {
                  const absVal = Math.abs(value);
                  const min = Math.round(absVal / 60);
                  const label = value < 0 ? `${min}m early` : `${min}m late`;
                  return [label, name];
                }}
              />
              <Legend wrapperStyle={{ position: 'relative', zIndex: 0 }} />
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
