'use client';

import { useState } from 'react';
import {
  ArrowUpDown,
  Accessibility,
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEquipmentStatus } from '@/hooks/use-equipment-status';
import { getRouteColor } from '@/lib/constants';
import type { ProcessedOutage } from '@/types/equipment';
import { cn } from '@/lib/utils';

function RouteChip({ route }: { route: string }) {
  const color = getRouteColor(route);
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded-sm"
      style={{
        backgroundColor: color,
        color: color === '#FCCC0A' ? '#000' : '#fff',
      }}
    >
      {route}
    </span>
  );
}

function OutageItem({ outage }: { outage: ProcessedOutage }) {
  const typeIcon = outage.type === 'elevator' ? (
    <ArrowUpDown className="h-4 w-4" />
  ) : (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 18h4l3-6 3 6h6" />
      <path d="M4 6h4l3 6" />
      <path d="M14 6h6" />
    </svg>
  );

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0">
      <div className={cn(
        "p-1.5 rounded",
        outage.isADA ? "bg-blue-500/20 text-blue-400" : "bg-muted"
      )}>
        {typeIcon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{outage.station}</span>
          {outage.isADA && (
            <Accessibility className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {outage.routes.slice(0, 4).map(route => (
            <RouteChip key={route} route={route} />
          ))}
          {outage.routes.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{outage.routes.length - 4}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{outage.serving}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {outage.reason}
          </Badge>
          {outage.daysOut > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {outage.daysOut}d out
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function OutageSection({
  title,
  outages,
  icon,
  defaultExpanded = true,
}: {
  title: string;
  outages: ProcessedOutage[];
  icon: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);

  const displayOutages = showAll ? outages : outages.slice(0, 5);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-sm">{title}</span>
          <Badge variant="secondary" className="text-xs">
            {outages.length}
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-0 max-h-[280px] overflow-y-auto">
          {displayOutages.map(outage => (
            <OutageItem key={outage.id} outage={outage} />
          ))}
          {outages.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show less' : `Show ${outages.length - 5} more`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function EquipmentStatusCard() {
  const { data, isLoading, error } = useEquipmentStatus();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5" />
            Elevator & Escalator Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5" />
            Elevator & Escalator Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            Failed to load equipment status
          </div>
        </CardContent>
      </Card>
    );
  }

  const { stats, currentOutages, upcomingOutages } = data;

  // Separate elevators and escalators in current outages
  const elevatorOutages = currentOutages.filter(o => o.type === 'elevator');
  const escalatorOutages = currentOutages.filter(o => o.type === 'escalator');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5" />
          Elevator & Escalator Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-muted/50 rounded-lg p-2">
            <div className="text-lg font-bold text-red-400">{stats.elevatorOutages}</div>
            <div className="text-[10px] text-muted-foreground">Elevators Out</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <div className="text-lg font-bold text-orange-400">{stats.escalatorOutages}</div>
            <div className="text-[10px] text-muted-foreground">Escalators Out</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <div className="text-lg font-bold text-blue-400">{stats.adaAffected}</div>
            <div className="text-[10px] text-muted-foreground">ADA Affected</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <div className="text-lg font-bold text-yellow-400">{stats.upcomingOutages}</div>
            <div className="text-[10px] text-muted-foreground">Upcoming</div>
          </div>
        </div>

        {/* Current Outages */}
        {currentOutages.length > 0 ? (
          <div className="space-y-4">
            {elevatorOutages.length > 0 && (
              <OutageSection
                title="Elevator Outages"
                outages={elevatorOutages}
                icon={<ArrowUpDown className="h-4 w-4 text-red-400" />}
              />
            )}
            {escalatorOutages.length > 0 && (
              <OutageSection
                title="Escalator Outages"
                outages={escalatorOutages}
                icon={<AlertTriangle className="h-4 w-4 text-orange-400" />}
                defaultExpanded={elevatorOutages.length === 0}
              />
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <ArrowUpDown className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>All equipment operational</p>
          </div>
        )}

        {/* Upcoming Outages */}
        {upcomingOutages.length > 0 && (
          <OutageSection
            title="Upcoming Outages"
            outages={upcomingOutages}
            icon={<Calendar className="h-4 w-4 text-yellow-400" />}
            defaultExpanded={false}
          />
        )}
      </CardContent>
    </Card>
  );
}
