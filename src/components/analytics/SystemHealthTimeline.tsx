'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HeartPulse } from 'lucide-react';
import { useDailyRollups } from '@/hooks/use-analytics-data';

export function SystemHealthTimeline() {
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const { data, loading } = useDailyRollups(from, to);

  const chartData = useMemo(() => {
    const rollups = data?.getDailyRollups ?? [];
    if (rollups.length === 0) return [];

    // Group by date, average across routes
    const byDate = new Map<string, { delays: number[]; onTimes: number[]; alerts: number }>();

    for (const r of rollups) {
      const entry = byDate.get(r.date) ?? { delays: [], onTimes: [], alerts: 0 };
      if (r.avgDelay != null) entry.delays.push(r.avgDelay);
      if (r.onTimePercent != null) entry.onTimes.push(r.onTimePercent);
      entry.alerts += r.totalAlerts ?? 0;
      byDate.set(r.date, entry);
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        dateLabel: format(new Date(date + 'T00:00:00'), 'MMM d'),
        avgDelay:
          v.delays.length > 0
            ? Math.round((v.delays.reduce((a, b) => a + b, 0) / v.delays.length) * 10) / 10
            : 0,
        onTimePercent:
          v.onTimes.length > 0
            ? Math.round((v.onTimes.reduce((a, b) => a + b, 0) / v.onTimes.length) * 10) / 10
            : 0,
        alerts: v.alerts,
      }));
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <HeartPulse className="h-4 w-4" />
          System Health (30 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            <p>No health data available yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <defs>
                <linearGradient id="onTimeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="delayGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="dateLabel"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                domain={[0, 100]}
                label={{
                  value: 'On-Time %',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#22c55e', fontSize: 11 },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 11 }}
                label={{
                  value: 'Avg Delay (s)',
                  angle: 90,
                  position: 'insideRight',
                  style: { fill: '#ef4444', fontSize: 11 },
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
                  if (name === 'onTimePercent') return [`${value}%`, 'On-Time'];
                  if (name === 'avgDelay') return [`${value}s`, 'Avg Delay'];
                  return [`${value}`, 'Alerts'];
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="onTimePercent"
                stroke="#22c55e"
                fillOpacity={1}
                fill="url(#onTimeGradient)"
                strokeWidth={2}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="avgDelay"
                stroke="#ef4444"
                fillOpacity={1}
                fill="url(#delayGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
