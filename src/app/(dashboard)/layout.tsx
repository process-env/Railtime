import { cookies } from 'next/headers';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AlertBanner } from '@/components/alerts';
import { PrefetchProvider } from '@/components/providers/PrefetchProvider';
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
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <AlertBanner />
          </header>
          <main className="flex-1 overflow-x-hidden overflow-y-auto">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PrefetchProvider>
  );
}
