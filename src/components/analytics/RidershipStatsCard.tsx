'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3 } from 'lucide-react';
import { useRidership } from '@/hooks/use-ridership';

const formatTotal = (value: number) => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
};

const getRecoveryColor = (percent: number) => {
  if (percent > 80) return 'text-green-400';
  if (percent >= 60) return 'text-yellow-400';
  return 'text-red-400';
};

export function RidershipStatsCard() {
  const { data, isLoading } = useRidership(30);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Ridership Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.latest) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Ridership Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">No ridership data available yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Ridership Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Latest Ridership</p>
            <p className="text-lg font-bold">
              {data.latest.ridership.toLocaleString()}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">30-Day Average</p>
            <p className="text-lg font-bold">
              {Math.round(data.avgDaily).toLocaleString()}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Pre-Pandemic Recovery</p>
            <p className={`text-lg font-bold ${getRecoveryColor(data.latest.prePandemicPercent)}`}>
              {data.latest.prePandemicPercent.toFixed(1)}%
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">30-Day Total</p>
            <p className="text-lg font-bold">
              {formatTotal(data.totalRidership)}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Daily Fare Revenue</p>
            <p className="text-lg font-bold text-green-400">
              {data.dailyFareRevenue > 0
                ? `$${(data.dailyFareRevenue / 1_000_000).toFixed(1)}M`
                : '--'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
