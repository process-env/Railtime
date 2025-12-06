'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';

interface TrainHistoryData {
  time: string;
  trainCount: number;
  routeCount: number;
}

interface TrainHistoryChartProps {
  data: TrainHistoryData[];
  compact?: boolean;
}

export function TrainHistoryChart({ data, compact = false }: TrainHistoryChartProps) {
  const height = compact ? 180 : 300;

  if (!data || data.length === 0) {
    return (
      <div className={`h-[${height}px] flex items-center justify-center text-muted-foreground`}>
        <p className={compact ? 'text-sm' : ''}>No historical data yet. Start collecting to see trends.</p>
      </div>
    );
  }

  const formattedData = data.map((d) => ({
    ...d,
    timeLabel: format(new Date(d.time), 'h a'), // "8 AM", "9 PM" format
    dateLabel: format(new Date(d.time), 'MMM d'),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={formattedData}
        margin={compact
          ? { top: 10, right: 10, left: -10, bottom: 0 }
          : { top: 20, right: 30, left: 20, bottom: 5 }
        }
      >
        <defs>
          <linearGradient id="trainGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey="timeLabel"
          stroke="#888"
          tick={{ fill: '#888', fontSize: compact ? 10 : 12 }}
          interval={compact ? 'preserveStartEnd' : 0}
          tickLine={!compact}
        />
        <YAxis
          stroke="#888"
          tick={{ fill: '#888', fontSize: compact ? 10 : 12 }}
          width={compact ? 30 : 40}
          tickLine={!compact}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
          }}
          labelStyle={{ color: '#fff' }}
          labelFormatter={(_, payload) => {
            if (payload?.[0]?.payload) {
              return `${payload[0].payload.dateLabel} ${payload[0].payload.timeLabel}`;
            }
            return '';
          }}
          formatter={(value: number, name: string) => {
            const label = name === 'trainCount' ? 'Trains' : 'Routes';
            return [`${value} ${label.toLowerCase()}`, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="trainCount"
          stroke="#3b82f6"
          fillOpacity={1}
          fill="url(#trainGradient)"
          strokeWidth={compact ? 1.5 : 2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
