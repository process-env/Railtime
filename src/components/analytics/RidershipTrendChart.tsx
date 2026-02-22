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
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Users } from 'lucide-react';
import { useRidership } from '@/hooks/use-ridership';

type TimeRange = '30d' | '90d' | '365d';

const RANGE_DAYS: Record<TimeRange, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

const formatRidership = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
};

export function RidershipTrendChart() {
  const [range, setRange] = useState<TimeRange>('30d');

  const { data, isLoading } = useRidership(RANGE_DAYS[range]);

  const chartData = useMemo(() => {
    if (!data?.days?.length) return [];

    // Data comes DESC from API — reverse to ascending for the chart
    const ascending = [...data.days].reverse();

    return ascending.map((day) => {
      const date = new Date(day.date);
      const dateLabel =
        range === '365d'
          ? format(date, 'MMM')
          : format(date, 'MMM d');

      return {
        date: day.date,
        dateLabel,
        ridership: day.ridership,
        prePandemicPercent: day.prePandemicPercent,
      };
    });
  }, [data, range]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Ridership Trends
        </CardTitle>
        <div className="flex gap-1">
          {(['30d', '90d', '365d'] as TimeRange[]).map((r) => (
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
        {isLoading ? (
          <Skeleton className="h-[300px]" />
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            <p>No ridership data available yet.</p>
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
                yAxisId="ridership"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                tickFormatter={formatRidership}
                label={{
                  value: 'Ridership',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#888', fontSize: 11 },
                }}
              />
              <YAxis
                yAxisId="percent"
                orientation="right"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                label={{
                  value: 'Pre-Pandemic %',
                  angle: 90,
                  position: 'insideRight',
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
                formatter={(value: number, name: string) => {
                  if (name === 'Pre-Pandemic %') {
                    return [`${value.toFixed(1)}%`, name];
                  }
                  return [formatRidership(value), name];
                }}
              />
              <Legend />
              <Line
                yAxisId="ridership"
                type="monotone"
                dataKey="ridership"
                name="Ridership"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="prePandemicPercent"
                name="Pre-Pandemic %"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
