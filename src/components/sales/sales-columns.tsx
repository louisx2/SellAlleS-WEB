'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Sale } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { SalesActions } from './sales-actions';
import { Badge } from '../ui/badge';
import { EcfEstadoBadge } from '@/components/ecf/ecf-estado-badge';
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
      if (row.original.cancelledAt) {
        return <Badge variant="destructive">Anulada</Badge>;
      }
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
    // Estado del e-CF ante la DGII. Vacía en las ventas que no lo llevan (serie B
    // o sin comprobante). Es el documento vigente: lo trae el listado de ventas
    // y se pone al día al recargar.
    id: 'dgii',
    header: 'DGII',
    cell: ({ row }) => {
      const ecf = row.original.ecf;
      return ecf ? <EcfEstadoBadge estado={ecf.estado} /> : null;
    },
  },
  {
    accessorKey: 'total',
    header: 'Total',
    cell: ({ row }) => (
      <span className={cn(row.original.cancelledAt && 'line-through text-muted-foreground')}>
        {formatCurrency(row.getValue('total'))}
      </span>
    ),
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
