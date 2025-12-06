'use client';

import { X, ArrowUp, ArrowDown, Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getRouteColor } from '@/lib/constants';
import { getDirectionFromStopId, formatEta, formatTime, getDirectionLabel, getTextColorForBackground } from '@/lib/mta/format';
import type { TrainPosition } from '@/types/mta';

interface TrainDetailPanelProps {
  train: TrainPosition | null;
  onClose: () => void;
  phase?: 'BOARDING' | 'ARRIVING' | 'APPROACHING' | null;
}

export function TrainDetailPanel({ train, onClose, phase }: TrainDetailPanelProps) {
  if (!train) return null;

  const direction = getDirectionFromStopId(train.nextStopId);
  const DirectionIcon = direction === 'N' ? ArrowUp : ArrowDown;
  const color = getRouteColor(train.routeId);
  const textColor = getTextColorForBackground(color);

  // Use headsign if available, otherwise fall back to direction label
  const destinationLabel = train.headsign || getDirectionLabel(direction);

  return (
    <div className="absolute top-4 right-6 w-80 z-10 animate-in slide-in-from-right duration-200">
      <Card className="bg-background/95 backdrop-blur shadow-xl border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge
                className="w-10 h-10 p-0 flex items-center justify-center text-lg font-bold rounded-lg"
                style={{ backgroundColor: color, color: textColor }}
              >
                {train.routeId}
              </Badge>
              <div>
                <CardTitle className="text-base">Train {train.routeId}</CardTitle>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <DirectionIcon className="h-3 w-3" />
                  <span>{destinationLabel}</span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Next Stop */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>Next Stop</span>
            </div>
            <div className="pl-6">
              <p className="font-medium">{train.nextStopName || 'Unknown'}</p>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {formatTime(train.eta)}
                </span>
                <span className={`text-sm font-medium ${
                  phase === 'BOARDING' ? 'text-amber-500' :
                  phase === 'ARRIVING' ? 'text-green-500' :
                  'text-green-400'
                }`}>
                  {phase === 'BOARDING' ? '(At Station)' :
                   phase === 'ARRIVING' ? '(Arriving)' :
                   `(${formatEta(train.eta, 'long')})`}
                </span>
              </div>
            </div>
          </div>

          {/* Trip Info */}
          <div className="pt-2 border-t border-border/50">
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block font-medium">Trip ID</span>
                <span className="font-mono text-foreground/70 truncate block" title={train.tripId}>
                  {train.tripId.length > 20 ? `${train.tripId.slice(0, 20)}...` : train.tripId}
                </span>
              </div>
              <div>
                <span className="block font-medium">Position</span>
                <span className="font-mono text-foreground/70">
                  {train.lat.toFixed(4)}, {train.lon.toFixed(4)}
                </span>
              </div>
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2 pt-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">Live tracking</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
