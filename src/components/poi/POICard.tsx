'use client';

import { ExternalLink, Phone, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { POI } from '@/types/poi';

interface POICardProps {
  poi: POI;
}

export function POICard({ poi }: POICardProps) {
  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${meters}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* Category icon */}
          <div className="text-2xl flex-shrink-0">{poi.categoryIcon}</div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium text-sm truncate">{poi.name}</h4>
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                {formatDistance(poi.distance)}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {poi.category}
            </p>

            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{poi.address}</span>
            </div>

            {/* Action links */}
            {(poi.phone || poi.url) && (
              <div className="flex items-center gap-3 mt-2">
                {poi.phone && (
                  <a
                    href={`tel:${poi.phone}`}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    <span>Call</span>
                  </a>
                )}
                {poi.url && (
                  <a
                    href={poi.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>Website</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
