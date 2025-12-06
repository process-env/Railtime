'use client';

import { DollarSign, Car, TrendingDown, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatNumber, type EconomicImpact } from '@/lib/analytics/impact-calculator';

interface EconomicImpactCardProps {
  impact: EconomicImpact | null;
  loading?: boolean;
}

export function EconomicImpactCard({ impact, loading }: EconomicImpactCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-400" />
            Economic Impact
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-muted rounded w-32" />
            <div className="h-4 bg-muted rounded w-24" />
            <div className="space-y-2">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!impact) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-400" />
            Economic Impact
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">No data available yet</p>
            <p className="text-xs mt-1">Start collecting train data to see impact</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-400" />
          Economic Impact
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main metric */}
          <div>
            <p className="text-3xl font-bold text-green-400">
              {formatCurrency(impact.totalSavings)}
            </p>
            <p className="text-xs text-muted-foreground">
              Total estimated savings
            </p>
          </div>

          {/* Riders estimate */}
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-blue-400" />
            <span className="text-muted-foreground">Est. riders:</span>
            <span className="font-semibold">{formatNumber(impact.estimatedRiders)}</span>
          </div>

          {/* Breakdown */}
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground font-medium">Savings vs alternatives:</p>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-xs text-muted-foreground">vs Uber</p>
                <p className="text-sm font-semibold text-green-400">
                  {formatCurrency(impact.vsUber)}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-xs text-muted-foreground">vs Taxi</p>
                <p className="text-sm font-semibold text-green-400">
                  {formatCurrency(impact.vsTaxi)}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-xs text-muted-foreground">vs Driving</p>
                <p className="text-sm font-semibold text-green-400">
                  {formatCurrency(impact.vsDriving)}
                </p>
              </div>
            </div>
          </div>

          {/* Per-trip savings */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingDown className="h-3 w-3" />
            Avg. ${impact.avgSavingsPerTrip.toFixed(2)} saved per trip
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
