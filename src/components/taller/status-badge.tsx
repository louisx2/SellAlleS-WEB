import { cn } from '@/lib/utils';
import { SERVICE_STATUS } from '@/lib/taller';
import type { ServiceStatus } from '@/lib/types';

export function StatusBadge({ status, className }: { status: ServiceStatus; className?: string }) {
  const meta = SERVICE_STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        meta?.badge,
        className,
      )}
    >
      {meta?.label ?? status}
    </span>
  );
}
