'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { useAlertsData } from '@/components/providers/AlertsProvider';
import { cn } from '@/lib/utils';
import { getRouteColor, SEVERITY_COLORS, ALERT_LIMITS } from '@/lib/constants';
import { getTextColorForBackground } from '@/lib/mta/format';
import type { ServiceAlert, AlertSeverity } from '@/types/mta';

// Slow reading pace - pixels per second (lower = slower for readability)
const TICKER_SPEED = 40;

interface AlertBannerProps {
  className?: string;
}

interface TickerSectionProps {
  alerts: ServiceAlert[];
  severity: AlertSeverity;
}

function TickerContent({ alerts }: { alerts: ServiceAlert[] }) {
  return (
    <>
      {alerts.map((alert) => (
        <span
          key={alert.id}
          className="inline-flex items-center gap-2 px-6 flex-shrink-0"
        >
          {/* Route circles */}
          {(alert.affectedRoutes ?? []).slice(0, ALERT_LIMITS.TICKER_ROUTES).map((route) => {
            const color = getRouteColor(route);
            const routeTextColor = getTextColorForBackground(color);
            return (
              <span
                key={`${alert.id}-${route}`}
                className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full"
                style={{ backgroundColor: color, color: routeTextColor }}
              >
                {route}
              </span>
            );
          })}
          {(alert.affectedRoutes?.length ?? 0) > ALERT_LIMITS.TICKER_ROUTES && (
            <span className="text-xs opacity-75">
              +{(alert.affectedRoutes?.length ?? 0) - ALERT_LIMITS.TICKER_ROUTES}
            </span>
          )}
          <span className="text-sm font-medium">{alert.headerText}</span>
          <span className="mx-6 opacity-50">•</span>
        </span>
      ))}
    </>
  );
}

function TickerSection({ alerts, severity }: TickerSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();
  const [contentWidth, setContentWidth] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const pausedXRef = useRef(0);

  useEffect(() => {
    if (!contentRef.current) return;
    // Measure the width of the content (one copy)
    const width = contentRef.current.scrollWidth / 2;
    setContentWidth(width);
    // Reset pause position when content changes
    pausedXRef.current = 0;
  }, [alerts]);

  useEffect(() => {
    if (contentWidth === 0 || isPaused) return;

    // Calculate remaining distance from paused position
    const startX = pausedXRef.current;
    const remaining = contentWidth + startX; // startX is negative or 0
    const duration = remaining / TICKER_SPEED;

    // Start (or resume) infinite scroll from the paused position
    controls.set({ x: startX });
    controls.start({
      x: -contentWidth,
      transition: {
        duration,
        ease: 'linear',
        repeat: Infinity,
        repeatType: 'loop',
      },
    });

    return () => {
      controls.stop();
    };
  }, [contentWidth, controls, isPaused]);

  if (alerts.length === 0) return null;

  const colors = SEVERITY_COLORS[severity];

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden py-1.5 flex items-center', colors.bg, colors.textOnBg)}
      onMouseEnter={() => {
        // Capture the current x position before stopping
        if (contentRef.current) {
          const style = getComputedStyle(contentRef.current);
          const matrix = new DOMMatrix(style.transform);
          // Wrap position within one content-width so the loop stays seamless
          pausedXRef.current = contentWidth > 0
            ? -((-matrix.m41) % contentWidth)
            : matrix.m41;
        }
        setIsPaused(true);
        controls.stop();
      }}
      onMouseLeave={() => {
        setIsPaused(false);
      }}
    >
      <motion.div
        ref={contentRef}
        className="inline-flex whitespace-nowrap will-change-transform"
        animate={controls}
        style={{ x: 0 }}
      >
        {/* Duplicate content for seamless loop */}
        <TickerContent alerts={alerts} />
        <TickerContent alerts={alerts} />
      </motion.div>
    </div>
  );
}

function TickerSkeleton({ severity }: { severity: AlertSeverity }) {
  const colors = SEVERITY_COLORS[severity];
  return <div className={cn('ticker-skeleton', colors.bg)} />;
}

export function AlertBanner({ className }: AlertBannerProps) {
  // Consume shared alerts from AlertsProvider context
  const { visibleAlerts, isLoading } = useAlertsData();

  const safeAlerts = visibleAlerts ?? [];
  const criticalAlerts = safeAlerts.filter((a) => a.severity === 'critical');
  const warningAlerts = safeAlerts.filter((a) => a.severity === 'warning');
  const infoAlerts = safeAlerts.filter((a) => a.severity === 'info');

  // Show loading skeleton during initial fetch
  if (isLoading && safeAlerts.length === 0) {
    return (
      <div className={cn('flex flex-col', className)}>
        <TickerSkeleton severity="critical" />
      </div>
    );
  }

  if (safeAlerts.length === 0) return null;

  return (
    <div className={cn('flex flex-col', className)}>
      <TickerSection alerts={criticalAlerts} severity="critical" />
      <TickerSection alerts={warningAlerts} severity="warning" />
      <TickerSection alerts={infoAlerts} severity="info" />
    </div>
  );
}
