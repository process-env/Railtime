'use client';

import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart as PieChartIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDailyRollups } from '@/hooks/use-analytics-data';

const COLORS: Record<string, string> = {
  on_time: '#22c55e',
  '0-2 min': '#84cc16',
  '2-5 min': '#eab308',
  '5-10 min': '#f97316',
  '10+ min': '#ef4444',
};

const LABELS: Record<string, string> = {
  on_time: 'On Time (<5 min)',
  '0-2 min': '0-2 min late',
  '2-5 min': '2-5 min late',
  '5-10 min': '5-10 min late',
  '10+ min': '10+ min late',
};

/**
 * Estimate delay distribution from rollup data.
 * Each rollup has onTimePercent and avgDelay. We use avgDelay to bucket
 * the "not on time" portion into delay categories.
 */
function computeDistribution(rollups: { onTimePercent: number | null; avgDelay: number | null }[]): { bucket: string; count: number }[] {
  let onTime = 0;
  let d0to2 = 0;
  let d2to5 = 0;
  let d5to10 = 0;
  let d10plus = 0;

  for (const r of rollups) {
    if (r.onTimePercent == null) continue;

    // On-time portion
    const onTimeFraction = r.onTimePercent / 100;
    onTime += onTimeFraction;

    // Late portion — bucket by avgDelay magnitude
    const lateFraction = 1 - onTimeFraction;
    if (lateFraction <= 0) continue;

    const delay = Math.abs(r.avgDelay ?? 0);
    if (delay < 120) {
      d0to2 += lateFraction;
    } else if (delay < 300) {
      d2to5 += lateFraction;
    } else if (delay < 600) {
      d5to10 += lateFraction;
    } else {
      d10plus += lateFraction;
    }
  }

  return [
    { bucket: 'on_time', count: Math.round(onTime * 100) },
    { bucket: '0-2 min', count: Math.round(d0to2 * 100) },
    { bucket: '2-5 min', count: Math.round(d2to5 * 100) },
    { bucket: '5-10 min', count: Math.round(d5to10 * 100) },
    { bucket: '10+ min', count: Math.round(d10plus * 100) },
  ];
}

interface DelayDistributionChartProps {
  compact?: boolean;
}

export function DelayDistributionChart({ compact = false }: DelayDistributionChartProps) {
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  const { data: rollupData, loading } = useDailyRollups(from, to);

  const height = compact ? 180 : 250;
  const innerRadius = compact ? 35 : 50;
  const outerRadius = compact ? 60 : 80;

  const distribution = useMemo(() => {
    const rollups = rollupData?.getDailyRollups ?? [];
    if (rollups.length === 0) return [];
    return computeDistribution(rollups);
  }, [rollupData]);

  const chartData = useMemo(() => {
    return distribution
      .filter((d) => d.count > 0)
      .map((d) => ({
        name: LABELS[d.bucket] || d.bucket,
        value: d.count,
        color: COLORS[d.bucket] || '#6b7280',
      }));
  }, [distribution]);

  const total = useMemo(() => chartData.reduce((sum, d) => sum + d.value, 0), [chartData]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PieChartIcon className="h-4 w-4" />
            Delay Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className={cn(compact ? 'h-[180px]' : 'h-[250px]')} />
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PieChartIcon className="h-4 w-4" />
            Delay Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn(compact ? 'h-[180px]' : 'h-[250px]', 'flex items-center justify-center text-muted-foreground')}>
            <p className={compact ? 'text-sm' : ''}>No delay data collected yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <PieChartIcon className="h-4 w-4" />
          Delay Distribution
          <span className="ml-auto text-xs text-muted-foreground font-normal">7-day avg</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy={compact ? '45%' : '50%'}
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
              }}
              itemStyle={{ color: '#fff' }}
              labelStyle={{ color: '#fff' }}
              formatter={(value: number, name: string) => [
                `${value} (${((value / total) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
            <Legend
              verticalAlign="bottom"
              height={compact ? 28 : 36}
              iconSize={compact ? 8 : 14}
              formatter={(value) => (
                <span style={{ color: '#fff', fontSize: compact ? '10px' : '12px' }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
