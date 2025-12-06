'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores';
import { getRouteColor, ALL_ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';

interface RouteFilterProps {
  compact?: boolean;
}

export function RouteFilter({ compact = false }: RouteFilterProps) {
  const { selectedRouteIds, toggleRouteFilter, clearRouteFilters } = useUIStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setCanScrollUp(scrollTop > 0);
      setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1);
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  const scrollUp = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ top: -100, behavior: 'smooth' });
    }
  };

  const scrollDown = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ top: 100, behavior: 'smooth' });
    }
  };

  if (compact) {
    // Compact vertical view with arrow navigation, max 60% viewport height
    return (
      <div className="flex flex-col items-center px-3">
        {canScrollUp && (
          <button
            onClick={scrollUp}
            className="w-6 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex flex-col gap-1.5 items-center py-1 px-1 max-h-[60vh] overflow-y-auto scrollbar-none"
        >
          {ALL_ROUTES.map((routeId) => {
            const color = getRouteColor(routeId);
            const isSelected = selectedRouteIds.includes(routeId);
            const textColor = color === '#FCCC0A' ? '#000' : '#fff';

            return (
              <button
                key={routeId}
                onClick={() => toggleRouteFilter(routeId)}
                className={cn(
                  'w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center transition-all shrink-0 border-2',
                  isSelected
                    ? 'border-white scale-110 shadow-lg'
                    : 'border-transparent opacity-50 hover:opacity-100'
                )}
                style={{
                  backgroundColor: color,
                  color: textColor,
                }}
              >
                {routeId === 'SI' ? 'S' : routeId}
              </button>
            );
          })}
          {selectedRouteIds.length > 0 && (
            <button
              onClick={clearRouteFilters}
              className="w-7 h-7 rounded-full text-[11px] bg-muted hover:bg-muted/80 flex items-center justify-center mt-1 shrink-0"
              title="Clear filters"
            >
              ×
            </button>
          )}
        </div>
        {canScrollDown && (
          <button
            onClick={scrollDown}
            className="w-6 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {ALL_ROUTES.map((routeId) => {
          const color = getRouteColor(routeId);
          const isSelected = selectedRouteIds.includes(routeId);
          const textColor = color === '#FCCC0A' ? '#000' : '#fff';

          return (
            <button
              key={routeId}
              onClick={() => toggleRouteFilter(routeId)}
              className={cn(
                'w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-all',
                isSelected
                  ? 'ring-2 ring-offset-2 ring-offset-background ring-primary scale-110'
                  : 'opacity-60 hover:opacity-100'
              )}
              style={{
                backgroundColor: color,
                color: textColor,
              }}
            >
              {routeId}
            </button>
          );
        })}
      </div>

      {selectedRouteIds.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearRouteFilters}
          className="w-full text-xs"
        >
          Clear filters ({selectedRouteIds.length})
        </Button>
      )}
    </div>
  );
}
