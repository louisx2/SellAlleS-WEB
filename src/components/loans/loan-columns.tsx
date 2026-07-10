'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { Loan } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';

// Factoría: la tasa de mora viene de companies.loan_late_fee_rate (perfil de
// empresa), independiente de la de ventas financiadas.
export const buildLoanColumns = (loanLateFeeRate: number): ColumnDef<Loan>[] => [
  {
    id: 'customerName',
    accessorFn: (row) => row.customer?.name ?? 'Cliente',
    header: 'Cliente',
  },
  {
    accessorKey: 'createdAt',
    header: 'Fecha',
    cell: ({ row }) => new Date(row.getValue('createdAt')).toLocaleDateString('es-DO'),
  },
  {
    accessorKey: 'principal',
    header: 'Monto prestado',
    cell: ({ row }) => formatCurrency(row.original.principal),
  },
  {
    id: 'installments',
    header: 'Cuotas Pagadas',
    cell: ({ row }) => {
      const status = calculateLoanStatus(row.original, loanLateFeeRate);
      return <span>{status.installmentsPaid} de {status.totalInstallments}</span>;
    },
  },
  {
    id: 'nextDueDate',
    header: 'Próximo Pago',
    cell: ({ row }) => {
      const status = calculateLoanStatus(row.original, loanLateFeeRate);
      if (status.pendingBalance <= 0) return <Badge variant="secondary">Completado</Badge>;
      return status.nextDueDate ? status.nextDueDate.toLocaleDateString('es-DO') : '—';
    },
  },
  {
    id: 'pendingBalance',
    header: 'Balance Pendiente',
    cell: ({ row }) => {
      const status = calculateLoanStatus(row.original, loanLateFeeRate);
      return <div className="font-medium text-destructive">{formatCurrency(status.pendingBalance)}</div>;
    },
  },
  {
    id: 'status',
    header: 'Estado',
    cell: ({ row }) => {
      const status = calculateLoanStatus(row.original, loanLateFeeRate);
      if (status.pendingBalance <= 0) return <Badge variant="default" className="bg-green-600">Pagado</Badge>;
      if (status.isOverdue) {
        return (
          <div className="flex flex-col">
            <Badge variant="destructive">Atrasado</Badge>
            <span className="text-xs text-destructive mt-1">Mora: {formatCurrency(status.lateFee)}</span>
          </div>
        );
      }
      return <Badge variant="outline">Al día</Badge>;
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/prestamos/${row.original.id}`}>
          <FileText className="mr-2 h-4 w-4" /> Ver detalle
        </Link>
      </Button>
    ),
  },
];
