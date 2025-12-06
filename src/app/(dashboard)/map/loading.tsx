import { Skeleton } from '@/components/ui/skeleton';

export default function MapLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-muted">
      <div className="text-center space-y-4">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    </div>
  );
}
