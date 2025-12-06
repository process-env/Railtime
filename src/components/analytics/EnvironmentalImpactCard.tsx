'use client';

import { Leaf, Car, TreePine, Wind } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber, type EnvironmentalImpact } from '@/lib/analytics/impact-calculator';

interface EnvironmentalImpactCardProps {
  impact: EnvironmentalImpact | null;
  loading?: boolean;
}

export function EnvironmentalImpactCard({ impact, loading }: EnvironmentalImpactCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Leaf className="h-4 w-4 text-emerald-400" />
            Environmental Impact
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-muted rounded w-32" />
            <div className="h-4 bg-muted rounded w-24" />
            <div className="space-y-2">
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
            <Leaf className="h-4 w-4 text-emerald-400" />
            Environmental Impact
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

  // Format CO2 for display
  const formatCO2 = (kg: number) => {
    if (kg >= 1000) {
      return `${(kg / 1000).toFixed(1)}t`;
    }
    return `${kg.toLocaleString()}kg`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Leaf className="h-4 w-4 text-emerald-400" />
          Environmental Impact
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main metric */}
          <div>
            <p className="text-3xl font-bold text-emerald-400">
              {formatCO2(impact.totalCO2SavedKg)}
            </p>
            <p className="text-xs text-muted-foreground">
              CO₂ emissions prevented
            </p>
          </div>

          {/* Per-trip savings */}
          <div className="flex items-center gap-2 text-sm">
            <Wind className="h-4 w-4 text-sky-400" />
            <span className="text-muted-foreground">Per trip:</span>
            <span className="font-semibold">{impact.co2SavedPerTrip}kg saved</span>
          </div>

          {/* Equivalents */}
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground font-medium">Equivalent to:</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3">
                <Car className="h-5 w-5 text-orange-400" />
                <div>
                  <p className="text-lg font-bold">{formatNumber(impact.carsOffRoadEquivalent)}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    cars off road<br />for a year
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3">
                <TreePine className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-lg font-bold">{formatNumber(impact.treesPlantedEquivalent)}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    trees planted<br />for a year
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Data source note */}
          <p className="text-[10px] text-muted-foreground/70">
            Based on EPA vehicle emissions data (404g CO₂/mile) vs MTA subway (27g CO₂/mile)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
