'use client';

import type { Sale } from '@/lib/types';
import { formatCurrency, cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Receipt } from 'lucide-react';

interface RecentSalesProps {
  sales: Sale[];
  /** Si se pasa, cada venta es clicable y abre su ticket. */
  onSelect?: (sale: Sale) => void;
}

const hora = (fecha: Date) =>
  fecha.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function RecentSales({ sales, onSelect }: RecentSalesProps) {
  return (
    <div className="space-y-1">
      {sales.map((sale) => {
        const cliente = sale.customer?.name ?? 'Cliente General';
        // El id completo no le dice nada a nadie. Lo que identifica la venta es
        // el NCF si lo lleva, y si no, sus primeros caracteres.
        const referencia = sale.ncf || `#${sale.id.slice(0, 8)}`;

        const contenido = (
          <>
            <Avatar className="h-9 w-9">
              <AvatarFallback>{cliente.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="ml-4 min-w-0 space-y-1 text-left">
              <p className="truncate text-sm font-medium leading-none">{cliente}</p>
              <p className="truncate text-xs text-muted-foreground">
                {hora(sale.createdAt)}
                {sale.userName ? ` · ${sale.userName}` : ''}
                {` · ${referencia}`}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2 pl-2">
              <span className="font-medium">{formatCurrency(sale.total)}</span>
              {onSelect && <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          </>
        );

        if (!onSelect) {
          return (
            <div key={sale.id} className="flex items-center px-2 py-2">
              {contenido}
            </div>
          );
        }

        return (
          <button
            key={sale.id}
            type="button"
            onClick={() => onSelect(sale)}
            title="Ver el ticket de esta venta"
            className={cn(
              'flex w-full items-center rounded-md px-2 py-2 text-left transition-colors',
              'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {contenido}
          </button>
        );
      })}
    </div>
  );
}
