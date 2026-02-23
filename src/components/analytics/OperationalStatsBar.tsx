'use client';

import { Train, Clock, AlertTriangle, Radio } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOperationalStats } from '@/hooks/use-operational-stats';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
}

function StatCard({ label, value, icon: Icon, color = 'text-foreground' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-muted p-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function OperationalStatsBar() {
  const stats = useOperationalStats();

  if (stats.loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[80px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Active Trains"
        value={stats.activeTrains}
        icon={Train}
      />
      <StatCard
        label="System On-Time"
        value={stats.onTimePercent != null ? `${stats.onTimePercent}%` : '--'}
        icon={Clock}
      />
      <StatCard
        label="Bunching Routes"
        value={stats.bunchingToday}
        icon={AlertTriangle}
        color={stats.bunchingToday > 15 ? 'text-orange-500' : 'text-foreground'}
      />
      <StatCard
        label="Gap Routes"
        value={stats.gapsToday}
        icon={Radio}
        color={stats.gapsToday > 10 ? 'text-red-500' : 'text-foreground'}
      />
    </div>
  );
}
