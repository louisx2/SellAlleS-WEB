'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Sale } from '@/lib/types';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { FinancingActions } from './financing-actions';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

export const financingColumns: ColumnDef<Sale>[] = [
  {
    accessorKey: 'customer.name',
    header: 'Cliente',
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
      const status = calculateFinancingStatus(row.original);
      if (!row.original.financingDetails) return 'N/A';
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
       const status = calculateFinancingStatus(row.original);
       if (!row.original.financingDetails || status.pendingBalance <= 0) return <Badge variant="secondary">Completado</Badge>;
       return new Date(status.nextDueDate).toLocaleDateString('es-DO');
    },
  },
  {
    id: 'pendingBalance',
    header: 'Balance Pendiente',
    cell: ({ row }) => {
      const status = calculateFinancingStatus(row.original);
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

      const status = calculateFinancingStatus(row.original);

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
      const status = calculateFinancingStatus(row.original);
      if (status.pendingBalance <= 0) return null;
      return <FinancingActions sale={row.original} />;
    }
  },
];
