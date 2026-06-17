import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

export function AppSkeleton() {
  return (
    <div className="flex min-h-screen">
      {/* Overlay with spinner */}
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>

      {/* Sidebar Skeleton */}
      <aside className="hidden md:flex flex-col w-64 border-r p-4 gap-4">
        <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-6 w-24" />
        </div>
        <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
            </div>
        </div>
        <div className="flex-grow space-y-2 mt-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
        </div>
        <div className='mt-auto'>
            <Skeleton className="h-10 w-full" />
        </div>
      </aside>
      
      {/* Main Content Skeleton */}
      <main className="flex-1 opacity-50">
        <header className="flex items-center h-16 px-4 border-b bg-card md:hidden">
            <Skeleton className="h-8 w-8" />
            <div className="flex items-center justify-center flex-1 gap-2">
                <Skeleton className="h-6 w-6" />
                <Skeleton className="h-6 w-24" />
            </div>
        </header>
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <div className='flex justify-between items-center'>
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-10 w-32" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Skeleton className="h-28 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
            </div>
            <div className="rounded-lg border">
                <div className='p-4'>
                    <Skeleton className="h-10 max-w-sm" />
                </div>
                 <div className='p-4 space-y-2'>
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                 </div>
            </div>
        </div>
      </main>
    </div>
  );
}
