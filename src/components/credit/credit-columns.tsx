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
    id: 'actions',
    cell: ({ row }) => <CreditActions customer={row.original} />,
  },
];
