'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Expense } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ExpenseActions } from './expense-actions';

export const expenseColumns: ColumnDef<Expense>[] = [
  {
    accessorKey: 'date',
    header: 'Fecha',
    cell: ({ row }) => {
      const date = new Date(row.getValue('date'));
      return date.toLocaleDateString('es-DO');
    },
  },
  {
    accessorKey: 'description',
    header: 'Descripción',
  },
  {
    accessorKey: 'category',
    header: 'Categoría',
    cell: ({ row }) => {
      const category = row.getValue('category') as string;
      return category ? <Badge variant="outline">{category}</Badge> : '—';
    }
  },
  {
    accessorKey: 'ncf',
    header: 'NCF',
    cell: ({ row }) => {
      const ncf = row.original.ncf;
      // Con NCF el gasto entra al Formato 606 del período.
      return ncf
        ? <Badge variant="secondary" className="font-mono text-[11px]">{ncf}</Badge>
        : <span className="text-muted-foreground text-xs">Sin comprobante</span>;
    },
  },
  {
    accessorKey: 'amount',
    header: 'Monto',
    cell: ({ row }) => formatCurrency(row.getValue('amount')),
  },
  {
    accessorKey: 'branchId',
    header: 'Sucursal',
    cell: ({ getValue }) => getValue<string>() || '—',
  },
  {
    id: 'actions',
    cell: ({ row }) => <ExpenseActions expense={row.original} />,
  },
];
