import { cookies } from 'next/headers';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AlertBanner } from '@/components/alerts';
import { PrefetchProvider } from '@/components/providers/PrefetchProvider';
import { AlertsProvider } from '@/components/providers/AlertsProvider';
import { ConductorProvider } from '@/components/conductor';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false';

  return (
    <PrefetchProvider>
      <AlertsProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <div className="flex-1 overflow-hidden">
                <AlertBanner />
              </div>
            </header>
            <main className="flex-1 overflow-x-hidden overflow-y-auto">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </SidebarInset>
        </SidebarProvider>
        <ConductorProvider>{null}</ConductorProvider>
      </AlertsProvider>
    </PrefetchProvider>
  );
}
