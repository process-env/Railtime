'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Map,
  BarChart3,
  Train,
  Bell,
  X,
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
import { Button } from '@/components/ui/button';
import { usePrefetchAnalytics, useAlerts } from '@/hooks';
import { RouteFilter } from './RouteFilter';
import { SubwayMapModal } from './SubwayMapModal';

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

      <SidebarContent>
        {/* Navigation - always visible */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const isPrefetchable = item.href === '/analytics';
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.label}
                  >
                    <Link
                      href={item.href}
                      onMouseEnter={isPrefetchable ? prefetchAnalytics : undefined}
                      onFocus={isPrefetchable ? prefetchAnalytics : undefined}
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

        {/* Route Filters - only show on map page */}
        {pathname === '/map' && (
          <SidebarGroup>
            <SidebarGroupLabel>Filter Routes</SidebarGroupLabel>
            <SidebarGroupContent>
              <RouteFilter compact={isCollapsed} />
            </SidebarGroupContent>
          </SidebarGroup>
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
    </Sidebar>
  );
}
