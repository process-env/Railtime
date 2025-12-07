'use client';

import { useState } from 'react';
import { AlertCircle, Coffee, Utensils, Building2, Pill, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePOISearch } from '@/hooks';
import { POICard } from './POICard';

interface POIListProps {
  lat: number;
  lon: number;
  radius?: number;
}

// Category buttons with TomTom category IDs
const CATEGORIES = [
  { id: undefined, label: 'All', icon: null },
  { id: '7315', label: 'Food', icon: Utensils },
  { id: '9376', label: 'Coffee', icon: Coffee },
  { id: '7397', label: 'Banks', icon: Building2 },
  { id: '9663', label: 'Pharmacy', icon: Pill },
  { id: '9361', label: 'Stores', icon: Store },
] as const;

export function POIList({ lat, lon, radius = 300 }: POIListProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);

  const { pois, isLoading, error } = usePOISearch(lat, lon, {
    radius,
    category: selectedCategory,
    limit: 10,
  });

  return (
    <div className="space-y-4">
      {/* Category filter buttons */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = selectedCategory === cat.id;
          return (
            <Button
              key={cat.label}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(cat.id)}
              className="h-8"
            >
              {Icon && <Icon className="h-3.5 w-3.5 mr-1" />}
              {cat.label}
            </Button>
          );
        })}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 p-4 text-sm text-destructive bg-destructive/10 rounded-lg">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {/* POI list */}
      {!isLoading && !error && (
        <>
          {pois.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No places found nearby
            </p>
          ) : (
            <div className="space-y-2">
              {pois.map((poi) => (
                <POICard key={poi.id} poi={poi} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
