import { cn } from '@/lib/utils';
import { SERVICE_STATUS, statusLabel, type StatusCtx } from '@/lib/taller';
import type { ServiceStatus } from '@/lib/types';

/** Distintivo del estado con el texto del camino de la orden («Llegó», «En
 *  proceso», «Terminado»…). El camino es obligatorio: sin él saldría «En
 *  reparación» en una orden que no es de reparación. */
export function StatusBadge({ status, ctx, className }: { status: ServiceStatus; ctx: StatusCtx; className?: string }) {
  const meta = SERVICE_STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        meta?.badge,
        className,
      )}
    >
      {meta ? statusLabel(status, ctx) : status}
    </span>
  );
}
