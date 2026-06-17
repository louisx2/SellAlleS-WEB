'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Expense } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
      return <Badge variant="outline">{category}</Badge>;
    }
  },
  {
    accessorKey: 'amount',
    header: 'Monto',
    cell: ({ row }) => formatCurrency(row.getValue('amount')),
  },
  {
    accessorKey: 'branchId',
    header: 'Sucursal',
  },
  {
    id: 'actions',
    cell: () => (
      <Button variant="ghost" className="h-8 w-8 p-0" disabled>
        <span className="sr-only">Abrir menú</span>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    ),
  },
];
