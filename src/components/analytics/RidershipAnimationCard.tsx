'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, DollarSign, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Percentage of daily ridership arriving in each hour (0-23). */
const HOURLY_PCT = [
  0.5, 0.3, 0.2, 0.2, 0.3, 1.5, // 12am-5am
  4.0, 8.0, 10.0, 8.0, 5.0, 4.5, // 6am-11am
  5.0, 5.0, 4.5, 5.0, 6.0, 9.0, // 12pm-5pm
  8.0, 6.0, 5.0, 4.0, 3.0, 2.0, // 6pm-11pm
];

/** Animation speed multiplier per hour — higher = faster playback. */
const SPEED = [
  0.3, 0.3, 0.3, 0.3, 0.3, 0.8, // overnight -> early
  0.8, 2.0, 2.5, 2.0, 0.6, 0.6, // morning rush
  0.6, 0.6, 0.6, 0.6, 0.8, 2.5, // midday -> evening rush
  2.0, 0.7, 0.7, 0.4, 0.4, 0.4, // evening -> late night
];

/** Base wall-clock milliseconds per simulated hour at 1x speed. */
const BASE_HOUR_MS = 800;

/** Hours considered rush hour (for visual glow). */
const RUSH_HOURS = new Set([7, 8, 9, 17, 18]);

// Pre-compute cumulative distribution: cumulativePct[i] is total % at end of hour i.
const cumulativePct: number[] = [];
HOURLY_PCT.reduce((acc, pct, i) => {
  const cum = acc + pct;
  cumulativePct[i] = cum;
  return cum;
}, 0);

// Pre-compute actual wall-clock duration (ms) for each hour segment.
const hourDurations = SPEED.map((s) => BASE_HOUR_MS / s);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RidershipAnimationCardProps {
  dailyRidership: number;
  dailyFareRevenue: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RidershipAnimationCard({
  dailyRidership,
  dailyFareRevenue,
}: RidershipAnimationCardProps) {
  // Display state — updated every animation frame
  const [currentRidership, setCurrentRidership] = useState(0);
  const [currentHour, setCurrentHour] = useState(0);
  const [currentMinute, setCurrentMinute] = useState(0);
  const [isRushHour, setIsRushHour] = useState(false);
  // Refs for animation loop bookkeeping (no re-renders needed)
  const rafRef = useRef<number>(0);
  const segmentStartRef = useRef(0); // timestamp when current hour segment started
  const hourIndexRef = useRef(0); // which hour (0-23) we're animating through
  const pausedRef = useRef(false); // true once animation completes

  // Keep latest props in a ref so the rAF callback always reads fresh values
  const propsRef = useRef({ dailyRidership, dailyFareRevenue });
  propsRef.current = { dailyRidership, dailyFareRevenue };

  // ------------------------------------------------------------------
  // Animation frame callback
  // ------------------------------------------------------------------

  const tick = useCallback((timestamp: number) => {
    // -- Animation complete — stop --
    if (pausedRef.current) {
      return;
    }

    const h = hourIndexRef.current;
    const elapsed = timestamp - segmentStartRef.current;
    const segDuration = hourDurations[h];
    let t = Math.min(elapsed / segDuration, 1); // progress within this hour

    // Compute cumulative ridership fraction
    const startFrac = h === 0 ? 0 : cumulativePct[h - 1] / 100;
    const endFrac = cumulativePct[h] / 100;
    const frac = startFrac + (endFrac - startFrac) * t;

    const total = propsRef.current.dailyRidership;
    const riders = Math.round(frac * total);

    // Compute simulated minute within this hour
    const minute = Math.min(Math.floor(t * 60), 59);

    // Batch state updates
    setCurrentRidership(riders);
    setCurrentHour(h);
    setCurrentMinute(minute);
    setIsRushHour(RUSH_HOURS.has(h));

    // Check if this hour segment is complete
    if (t >= 1) {
      if (h < 23) {
        hourIndexRef.current = h + 1;
        segmentStartRef.current = timestamp;
      } else {
        // Reached end of day — stop animation
        pausedRef.current = true;
        setIsRushHour(false);
        // Snap final display to 11:59 PM at full totals
        setCurrentHour(23);
        setCurrentMinute(59);
        setCurrentRidership(total);
        return;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  useEffect(() => {
    // Kick off animation
    const start = (ts: number) => {
      segmentStartRef.current = ts;
      hourIndexRef.current = 0;
      pausedRef.current = false;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(start);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  // ------------------------------------------------------------------
  // Derived display values
  // ------------------------------------------------------------------

  const hours12 = currentHour % 12 || 12;
  const ampm = currentHour < 12 ? 'AM' : 'PM';
  const timeStr = `${hours12}:${String(currentMinute).padStart(2, '0')} ${ampm}`;

  const revenueFrac =
    dailyRidership > 0 ? currentRidership / dailyRidership : 0;
  const currentRevenue = revenueFrac * dailyFareRevenue;
  const revenueStr =
    dailyRidership === 0
      ? '--'
      : currentRevenue >= 1_000_000
        ? `$${(currentRevenue / 1_000_000).toFixed(1)}M`
        : `$${Math.round(currentRevenue / 1_000).toLocaleString()}k`;

  const ridershipStr =
    dailyRidership === 0 ? '--' : currentRidership.toLocaleString();

  const progressPct = Math.min(
    ((currentHour * 60 + currentMinute) / 1440) * 100,
    100,
  );

  const todayLabel = format(new Date(), 'EEEE, MMMM d, yyyy');

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <motion.div
      animate={{
        boxShadow: isRushHour
          ? '0 0 8px rgba(0,200,255,0.15)'
          : '0 0 0px rgba(0,200,255,0)',
      }}
      transition={{ duration: 0.6 }}
      className="rounded-xl"
    >
      <Card
        className={cn(
          'transition-colors duration-500',
          isRushHour && 'border-cyan-500/20',
        )}
      >
        <CardContent className="pt-6 space-y-4">
          {/* Date line */}
          <p className="text-xs text-muted-foreground">{todayLabel}</p>

          {/* Metrics row */}
          <div className="flex items-start justify-between gap-4">
            {/* Simulated time */}
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-2xl font-bold tabular-nums leading-tight">
                  {timeStr}
                </p>
                <p className="text-xs text-muted-foreground">Simulated time</p>
              </div>
            </div>

            {/* Ridership counter */}
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-2xl font-bold tabular-nums leading-tight">
                  {ridershipStr}
                </p>
                <p className="text-xs text-muted-foreground">riders today</p>
              </div>
            </div>

            {/* Revenue counter */}
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-2xl font-bold tabular-nums leading-tight">
                  {revenueStr}
                </p>
                <p className="text-xs text-muted-foreground">fare revenue</p>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <motion.div
              className={cn(
                'h-full rounded-full',
                isRushHour ? 'bg-cyan-400' : 'bg-primary',
              )}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.3, ease: 'linear' }}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
