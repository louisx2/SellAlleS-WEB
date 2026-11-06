'use client';

import type { EcfEstado } from '@/lib/types';
import { ecfEstadoEtiqueta } from '@/lib/ecf';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const CLASE_POR_TONO = {
  ok: 'text-green-700 border-green-700 dark:text-green-400 dark:border-green-500',
  espera: 'text-amber-700 border-amber-600 dark:text-amber-400 dark:border-amber-500',
  error: 'text-destructive border-destructive',
} as const;

/** Dónde va un e-CF en la DGII, con el color de su tono. Lo usan Movimientos y el detalle de la venta. */
export function EcfEstadoBadge({ estado, className }: { estado: EcfEstado; className?: string }) {
  const { texto, tono } = ecfEstadoEtiqueta(estado);
  return (
    <Badge variant="outline" className={cn(CLASE_POR_TONO[tono], className)}>
      {texto}
    </Badge>
  );
}
