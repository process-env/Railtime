'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { getRouteColor } from '@/lib/constants';

interface RouteActivityData {
  routeId: string;
  trainCount: number;
}

interface RouteActivityChartProps {
  data: RouteActivityData[];
}

export function RouteActivityChart({ data }: RouteActivityChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey="routeId"
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
          itemStyle={{ color: '#fff' }}
          formatter={(value: number) => [`${value} trains`, 'Active']}
        />
        <Bar dataKey="trainCount" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getRouteColor(entry.routeId)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
