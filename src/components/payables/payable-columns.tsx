import type { ColumnDef } from '@tanstack/react-table';
import type { SupplierInvoice, SupplierInvoiceStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn, formatCurrency } from '@/lib/utils';
import { PayableActions } from './payable-actions';

const formatDateStr = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const STATUS_LABEL: Record<SupplierInvoiceStatus, string> = {
  pending: 'Pendiente',
  partial: 'Abonada',
  paid: 'Pagada',
};

const STATUS_CLASS: Record<SupplierInvoiceStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  partial: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

// Antigüedad del saldo respecto al vencimiento (solo facturas con balance).
const AgingBadge = ({ invoice }: { invoice: SupplierInvoice }) => {
  if (invoice.balance <= 0 || !invoice.dueDate) return null;
  const due = new Date(invoice.dueDate + 'T00:00:00');
  const days = Math.floor((Date.now() - due.getTime()) / 86400000);
  if (days <= 0) return <span className="text-xs text-muted-foreground">Al día</span>;
  const cls =
    days <= 30 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : days <= 60 ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'
    : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
  const bucket = days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
  return <Badge variant="outline" className={cn('border-transparent', cls)}>{bucket} días</Badge>;
};

export const buildPayableColumns = (showFiscal: boolean): ColumnDef<SupplierInvoice>[] => [
  {
    accessorKey: 'issueDate',
    header: 'Fecha',
    cell: ({ row }) => formatDateStr(row.original.issueDate),
  },
  {
    id: 'supplier',
    accessorFn: (row) => row.supplier?.name ?? '',
    header: 'Suplidor',
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.supplier?.name ?? '—'}</div>
        {row.original.invoiceNumber && (
          <div className="text-xs text-muted-foreground">No. {row.original.invoiceNumber}</div>
        )}
      </div>
    ),
  },
  ...(showFiscal
    ? [{
        accessorKey: 'ncf',
        id: 'ncf',
        header: 'NCF',
        cell: ({ row }) => row.original.ncf ?? <span className="text-muted-foreground">—</span>,
      } as ColumnDef<SupplierInvoice>]
    : []),
  {
    accessorKey: 'dueDate',
    header: 'Vencimiento',
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <span>{formatDateStr(row.original.dueDate)}</span>
        <AgingBadge invoice={row.original} />
      </div>
    ),
  },
  {
    accessorKey: 'total',
    header: () => <div className="text-right">Total</div>,
    cell: ({ row }) => <div className="text-right">{formatCurrency(row.original.total)}</div>,
  },
  {
    accessorKey: 'amountPaid',
    header: () => <div className="text-right">Abonado</div>,
    cell: ({ row }) => <div className="text-right">{formatCurrency(row.original.amountPaid)}</div>,
  },
  {
    accessorKey: 'balance',
    header: () => <div className="text-right">Balance</div>,
    cell: ({ row }) => (
      <div className={cn('text-right font-semibold', row.original.balance > 0 && 'text-destructive')}>
        {formatCurrency(Math.max(row.original.balance, 0))}
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant="outline" className={cn('border-transparent', STATUS_CLASS[row.original.status])}>
        {STATUS_LABEL[row.original.status]}
      </Badge>
    ),
  },
  {
    id: 'actions',
    cell: ({ row }) => <PayableActions invoice={row.original} />,
  },
];
