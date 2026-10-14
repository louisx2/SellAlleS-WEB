'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { Sale } from '@/lib/types';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { formatQtyCompact } from '@/lib/units';
import { FinancingActions } from './financing-actions';
import { Badge } from '../ui/badge';

const itemLabel = (item: Sale['items'][number]) =>
  item.quantity === 1 ? item.product.name : `${formatQtyCompact(item.quantity, item.product.unit)} × ${item.product.name}`;

// Factoría: la tasa de mora viene de companies.late_fee_rate (perfil de empresa).
export const buildFinancingColumns = (lateFeeRate: number, graceDays = 0): ColumnDef<Sale>[] => [
  {
    accessorKey: 'customer.name',
    header: 'Cliente',
    cell: ({ row }) => (
      <Link href={`/financing/detail?id=${row.original.id}`} className="font-medium hover:underline underline-offset-2">
        {row.original.customer?.name ?? 'Consumidor Final'}
      </Link>
    ),
    // El buscador de la tabla filtra por esta columna: que encuentre también
    // por artículo ("¿quién se llevó la nevera?").
    filterFn: (row, _columnId, value: string) => {
      const q = value.trim().toLowerCase();
      if (!q) return true;
      const sale = row.original;
      return (sale.customer?.name ?? '').toLowerCase().includes(q)
        || sale.items.some(i => i.product.name.toLowerCase().includes(q));
    },
  },
  {
    id: 'items',
    header: 'Artículos',
    cell: ({ row }) => {
      const items = row.original.items;
      if (items.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="max-w-64" title={items.map(itemLabel).join('\n')}>
          <p className="line-clamp-2">{itemLabel(items[0])}</p>
          {items.length > 1 && (
            <p className="text-xs text-muted-foreground">
              y {items.length - 1} artículo{items.length > 2 ? 's' : ''} más
            </p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Fecha de Venta',
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt'));
      return date.toLocaleDateString('es-DO');
    },
  },
  {
    id: 'installments',
    header: 'Cuotas Pagadas',
    cell: ({ row }) => {
      const status = calculateFinancingStatus(row.original, lateFeeRate, graceDays);
      if (status.totalInstallments === 0) return 'N/A';
      return (
        <span>
          {status.installmentsPaid} de {status.totalInstallments}
        </span>
      );
    },
  },
  {
    id: 'nextDueDate',
    header: 'Próximo Pago',
    cell: ({ row }) => {
       const status = calculateFinancingStatus(row.original, lateFeeRate, graceDays);
       if (status.pendingBalance <= 0) return <Badge variant="secondary">Completado</Badge>;
       if (!status.nextDueDate) return '—';
       return status.nextDueDate.toLocaleDateString('es-DO');
    },
  },
  {
    id: 'pendingBalance',
    header: 'Balance Pendiente',
    cell: ({ row }) => {
      const status = calculateFinancingStatus(row.original, lateFeeRate, graceDays);
      return <div className="font-medium text-destructive">{formatCurrency(status.pendingBalance)}</div>;
    },
  },
  {
    id: 'status',
    header: 'Estado',
    cell: ({ row }) => {
      if (row.original.paymentMethod !== 'financing') {
         return <Badge variant="outline">Crédito Simple</Badge>
      }

      const status = calculateFinancingStatus(row.original, lateFeeRate, graceDays);

      if (status.pendingBalance <= 0) {
        return <Badge variant="default" className="bg-green-600">Pagado</Badge>;
      }

      if (status.isOverdue) {
          return (
             <div className="flex flex-col">
                <Badge variant="destructive">Atrasado</Badge>
                <span className="text-xs text-destructive mt-1">Mora: {formatCurrency(status.lateFee)}</span>
             </div>
          )
      }

      return <Badge variant="outline">Al día</Badge>;
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const status = calculateFinancingStatus(row.original, lateFeeRate, graceDays);
      return <FinancingActions sale={row.original} canPay={status.pendingBalance > 0} />;
    }
  },
];
