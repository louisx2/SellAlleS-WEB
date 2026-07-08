'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Customer } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { CreditActions } from './credit-actions';

export const creditColumns: ColumnDef<Customer>[] = [
  {
    accessorKey: 'name',
    header: 'Cliente',
  },
  {
    accessorKey: 'phone',
    header: 'Teléfono',
  },
  {
    accessorKey: 'creditBalance',
    header: 'Balance Pendiente',
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue('creditBalance'))
      return <div className="font-medium text-destructive">{formatCurrency(amount)}</div>
    },
  },
  {
    id: 'creditLimit',
    header: 'Límite de Crédito',
    cell: ({ row }) => {
      const limit = row.original.creditLimit;
      if (limit == null) return <span className="text-muted-foreground">Sin límite</span>;
      const available = Math.max(limit - row.original.creditBalance, 0);
      return (
        <div>
          <div>{formatCurrency(limit)}</div>
          <div className="text-xs text-muted-foreground">Disponible: {formatCurrency(available)}</div>
        </div>
      );
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <CreditActions customer={row.original} />,
  },
];
