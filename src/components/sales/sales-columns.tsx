'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Sale } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { SalesActions } from './sales-actions';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

export const salesColumns: ColumnDef<Sale>[] = [
  {
    accessorKey: 'id',
    header: 'ID Venta',
  },
  {
    accessorKey: 'createdAt',
    header: 'Fecha',
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt'));
      return date.toLocaleDateString('es-DO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    },
  },
   {
    accessorKey: 'customer.name',
    header: 'Cliente',
  },
  {
    accessorKey: 'branchId',
    header: 'Sucursal',
  },
  {
    accessorKey: 'paymentMethod',
    header: 'Método de Pago',
    cell: ({ row }) => {
      const method: Sale['paymentMethod'] = row.getValue('paymentMethod');
      
      const methodText = {
        cash: 'Efectivo',
        card: 'Tarjeta',
        transfer: 'Transferencia',
        credit: 'Crédito',
        financing: 'Financiamiento'
      }

      return (
        <Badge
          className="capitalize"
          variant="outline"
        >
          {methodText[method]}
        </Badge>
      );
    },
  },
   {
    accessorKey: 'paymentStatus',
    header: 'Estado',
    cell: ({ row }) => {
      const status: Sale['paymentStatus'] = row.getValue('paymentStatus');
      const isCredit = status === 'credit' || status === 'in_financing';
      return (
        <Badge
          className={cn(isCredit ? 'text-destructive border-destructive' : 'text-green-700 border-green-700')}
          variant="outline"
        >
          {isCredit ? 'Pendiente' : 'Pagado'}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'total',
    header: 'Total',
    cell: ({ row }) => formatCurrency(row.getValue('total')),
  },
  {
    accessorKey: 'userName',
    header: 'Vendedor',
    cell: ({ getValue }) => getValue<string>() || '—',
  },
  {
    id: 'actions',
    cell: ({ row }) => <SalesActions sale={row.original} />,
  },
];
