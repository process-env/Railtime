'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Map,
  BarChart3,
  Train,
  Bell,
  X,
  Navigation,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { usePrefetchAnalytics, usePrefetchMap, useAlerts } from '@/hooks';
import { RouteFilter } from './RouteFilter';
import { SubwayMapModal } from './SubwayMapModal';
import { TripPlannerPanel } from '@/components/trip-planner';
import { NearbyArrivalsWidget } from './NearbyArrivalsWidget';

const navItems = [
  { href: '/map', label: 'Live Map', icon: Map },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/stations', label: 'Stations', icon: Train },
  { href: '/alerts', label: 'Alerts', icon: Bell, showBadge: true },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const { alerts } = useAlerts();
  const alertCount = alerts.length;
  const prefetchAnalytics = usePrefetchAnalytics();
  const prefetchMap = usePrefetchMap();
  const [tripPlannerOpen, setTripPlannerOpen] = useState(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/map">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Train className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">MTA Tracker</span>
                  <span className="truncate text-xs text-muted-foreground">NYC Subway</span>
                </div>
              </Link>
            </SidebarMenuButton>
            {!isCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close sidebar</span>
              </Button>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="scrollbar-none">
        {/* Navigation - always visible */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const prefetchFn = item.href === '/analytics' ? prefetchAnalytics
                : item.href === '/map' ? prefetchMap
                : undefined;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.label}
                  >
                    <Link
                      href={item.href}
                      onMouseEnter={prefetchFn}
                      onFocus={prefetchFn}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.showBadge && alertCount > 0 && !isCollapsed && (
                    <SidebarMenuBadge className="bg-destructive text-destructive-foreground text-[10px] min-w-4 h-4 px-1">
                      {alertCount > 9 ? '9+' : alertCount}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        {/* Trip Planner */}
        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setTripPlannerOpen(true)}
                tooltip="Trip Planner"
              >
                <Navigation />
                <span>Trip Planner</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Route Filters - only show on map page */}
        {pathname === '/map' && (
          <SidebarGroup>
            <SidebarGroupLabel>Filter Routes</SidebarGroupLabel>
            <SidebarGroupContent>
              <RouteFilter compact={isCollapsed} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Nearby Arrivals - only show on map page */}
        {pathname === '/map' && (
          <NearbyArrivalsWidget isCollapsed={isCollapsed} />
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SubwayMapModal tooltip="Subway Map" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      {/* Trip Planner Sheet */}
      <Sheet open={tripPlannerOpen} onOpenChange={setTripPlannerOpen}>
        <SheetContent
          side="left"
          className="w-[400px] p-0 sm:max-w-[400px] bg-sidebar border-sidebar-border"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Trip Planner</SheetTitle>
          </SheetHeader>
          <TripPlannerPanel className="h-full" />
        </SheetContent>
      </Sheet>
    </Sidebar>
  );
}
