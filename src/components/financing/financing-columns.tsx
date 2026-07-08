'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Sale } from '@/lib/types';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { FinancingActions } from './financing-actions';
import { Badge } from '../ui/badge';

// Factoría: la tasa de mora viene de companies.late_fee_rate (perfil de empresa).
export const buildFinancingColumns = (lateFeeRate: number): ColumnDef<Sale>[] => [
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
      const status = calculateFinancingStatus(row.original, lateFeeRate);
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
       const status = calculateFinancingStatus(row.original, lateFeeRate);
       if (status.pendingBalance <= 0) return <Badge variant="secondary">Completado</Badge>;
       if (!status.nextDueDate) return '—';
       return status.nextDueDate.toLocaleDateString('es-DO');
    },
  },
  {
    id: 'pendingBalance',
    header: 'Balance Pendiente',
    cell: ({ row }) => {
      const status = calculateFinancingStatus(row.original, lateFeeRate);
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

      const status = calculateFinancingStatus(row.original, lateFeeRate);

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
      const status = calculateFinancingStatus(row.original, lateFeeRate);
      return <FinancingActions sale={row.original} canPay={status.pendingBalance > 0} />;
    }
  },
];
