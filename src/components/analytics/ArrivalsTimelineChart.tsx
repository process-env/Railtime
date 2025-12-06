'use client';

import { Clock, Database } from 'lucide-react';

interface TimelineData {
  time: string;
  arrivals: number;
  departures: number;
}

interface ArrivalsTimelineChartProps {
  data: TimelineData[];
}

export function ArrivalsTimelineChart({ data }: ArrivalsTimelineChartProps) {
  // Check if data is placeholder (all values are the same)
  const isPlaceholder = data.length > 0 &&
    data.every(d => d.arrivals === data[0].arrivals && d.departures === data[0].departures);

  if (isPlaceholder) {
    const currentTrainCount = data[0]?.arrivals || 0;

    return (
      <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
        <Database className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium mb-2">Historical Data Disabled</p>
        <p className="text-sm text-center max-w-sm mb-4">
          Historical tracking is currently disabled for performance optimization.
        </p>
        <div className="flex items-center gap-2 px-4 py-2 bg-background rounded-md border">
          <Clock className="h-4 w-4" />
          <span className="text-sm">
            <span className="font-semibold text-foreground">{currentTrainCount}</span> trains active now
          </span>
        </div>
      </div>
    );
  }

  // Original chart code - kept for when historical data is re-enabled
  const {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
  } = require('recharts');

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey="time"
          stroke="#888"
          tick={{ fill: '#888', fontSize: 12 }}
        />
        <YAxis stroke="#888" tick={{ fill: '#888', fontSize: 12 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
          }}
          labelStyle={{ color: '#fff' }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="arrivals"
          stroke="#06b6d4"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="departures"
          stroke="#a855f7"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
