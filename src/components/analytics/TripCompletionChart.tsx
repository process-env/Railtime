'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

export function TripCompletionChart() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Trip Completion Rate
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
          <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium mb-2">Trip Intelligence</p>
          <p className="text-sm text-center max-w-sm">
            Collecting trip lifecycle data. Trip completion rates, average durations,
            and route-level statistics will appear here as data accumulates.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
