'use client';

import { useRouter } from 'next/navigation';
import { ExternalLink, Phone, MapPin, Navigation } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { POI } from '@/types/poi';

interface POICardProps {
  poi: POI;
}

export function POICard({ poi }: POICardProps) {
  const router = useRouter();

  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${meters}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  // Ensure URL has protocol
  const getFullUrl = (url: string): string => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `https://${url}`;
  };

  // Navigate to map centered on this POI
  const handleShowOnMap = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Store POI location in URL params for the map to pick up
    router.push(`/map?poi=${poi.lat},${poi.lon}&poiName=${encodeURIComponent(poi.name)}`);
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
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={handleShowOnMap}
              >
                <Navigation className="h-3 w-3 mr-1" />
                Map
              </Button>
              {poi.phone && (
                <a
                  href={`tel:${poi.phone}`}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="h-3 w-3" />
                  <span>Call</span>
                </a>
              )}
              {poi.url && (
                <a
                  href={getFullUrl(poi.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Website</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
