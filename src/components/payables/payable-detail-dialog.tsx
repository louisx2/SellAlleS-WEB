'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { SupplierInvoice, SupplierInvoiceItem, SupplierPayment } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import { useProducts } from '@/context/product-provider';
import { formatLineQty } from '@/lib/line-format';
import { EXPENSE_TYPES_606, ISR_RETENTION_TYPES_606, PAYMENT_FORMS_606 } from '@/lib/dgii-606';

interface PayableDetailDialogProps {
  invoice: SupplierInvoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Solo para administradores: sin esto no se ofrece anular. */
  onVoidPayment?: (payment: SupplierPayment) => void;
}

const formatDateStr = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const catalogLabel = (catalog: { code: string; label: string }[], code?: string) =>
  code ? (catalog.find((c) => c.code === code)?.label ?? code) : '—';

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-4 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{value}</span>
  </div>
);

export function PayableDetailDialog({ invoice, open, onOpenChange, onVoidPayment }: PayableDetailDialogProps) {
  const { products } = useProducts();
  const retenciones = invoice.itbisRetenido + invoice.isrRetentionAmount;
  const hasFiscal = !!invoice.ncf || invoice.itbisFacturado > 0 || retenciones > 0;

  // La línea guardada no trae la unidad del producto, solo su id. Con presentación
  // hace falta ("2 Saco x125 lb"); el producto puede estar archivado o no cargado, y
  // entonces queda "2 Saco x125". Una línea suelta se muestra como siempre: sin unidad.
  const lineQty = (item: SupplierInvoiceItem) =>
    formatLineQty({
      quantity: item.quantity,
      presentation: item.presentation,
      product: {
        unit: item.presentation
          ? (products.find((p) => p.id === item.productId)?.unit ?? 'und')
          : 'und',
      },
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle de Factura</DialogTitle>
          <DialogDescription>
            {invoice.supplier?.name ?? '—'}
            {invoice.invoiceNumber ? ` · No. ${invoice.invoiceNumber}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Row label="Fecha del comprobante" value={formatDateStr(invoice.issueDate)} />
          <Row label="Vencimiento" value={formatDateStr(invoice.dueDate)} />
          {invoice.branchId && <Row label="Sucursal" value={invoice.branchId} />}
          {invoice.userName && <Row label="Registrada por" value={invoice.userName} />}
          {invoice.notes && <Row label="Notas" value={invoice.notes} />}
        </div>

        {hasFiscal && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Datos fiscales (DGII)</p>
              <Row label="NCF" value={invoice.ncf ?? '—'} />
              {invoice.ncfModified && <Row label="NCF modificado" value={invoice.ncfModified} />}
              <Row label="Tipo de gasto (606)" value={catalogLabel(EXPENSE_TYPES_606, invoice.expenseType)} />
              <Row label="ITBIS facturado" value={formatCurrency(invoice.itbisFacturado)} />
              {invoice.itbisRetenido > 0 && <Row label="ITBIS retenido" value={formatCurrency(invoice.itbisRetenido)} />}
              {invoice.itbisProporcionalidad > 0 && <Row label="ITBIS proporcionalidad" value={formatCurrency(invoice.itbisProporcionalidad)} />}
              {invoice.itbisLlevadoCosto > 0 && <Row label="ITBIS llevado al costo" value={formatCurrency(invoice.itbisLlevadoCosto)} />}
              {invoice.isrRetentionAmount > 0 && (
                <>
                  <Row label="Tipo retención ISR" value={catalogLabel(ISR_RETENTION_TYPES_606, invoice.isrRetentionType)} />
                  <Row label="Retención renta" value={formatCurrency(invoice.isrRetentionAmount)} />
                </>
              )}
              {invoice.impuestoSelectivo > 0 && <Row label="Impuesto selectivo" value={formatCurrency(invoice.impuestoSelectivo)} />}
              {invoice.otrosImpuestos > 0 && <Row label="Otros impuestos" value={formatCurrency(invoice.otrosImpuestos)} />}
              {invoice.propinaLegal > 0 && <Row label="Propina legal" value={formatCurrency(invoice.propinaLegal)} />}
              <Row label="Forma de pago (606)" value={catalogLabel(PAYMENT_FORMS_606, invoice.paymentForm)} />
            </div>
          </>
        )}

        {invoice.items.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Productos / líneas</p>
              {invoice.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-4 text-sm">
                  <span>
                    {item.description}
                    <span className="text-muted-foreground"> × {lineQty(item)}</span>
                  </span>
                  <span className="font-medium">{formatCurrency(item.quantity * item.unitCost)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <Separator />
        <div className="space-y-1.5">
          <Row label="Monto bienes" value={formatCurrency(invoice.subtotalGoods)} />
          <Row label="Monto servicios" value={formatCurrency(invoice.subtotalServices)} />
          <Row label="Total factura" value={formatCurrency(invoice.total)} />
          {retenciones > 0 && <Row label="Retenciones (se remiten a DGII)" value={`- ${formatCurrency(retenciones)}`} />}
          <Row label="Abonado" value={formatCurrency(invoice.amountPaid)} />
          <Row
            label="Balance pendiente"
            value={<span className={invoice.balance > 0 ? 'text-destructive' : 'text-emerald-600'}>{formatCurrency(Math.max(invoice.balance, 0))}</span>}
          />
        </div>

        {invoice.payments.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Abonos</p>
              {/* Los anulados se quedan a la vista, tachados y con su motivo:
                  nunca fueron dinero y ya no suman al abonado. */}
              {invoice.payments.map((p) => (
                <div key={p.id} className={cn('flex items-center justify-between gap-4 text-sm', p.voidedAt && 'opacity-60')}>
                  <span className="text-muted-foreground">
                    {p.date.toLocaleDateString('es-DO')} · {p.method === 'cash' ? 'Efectivo' : p.method === 'card' ? 'Tarjeta' : 'Transferencia'}
                    {p.userName ? ` · ${p.userName}` : ''}
                    {p.voidedAt && (
                      <span className="block text-destructive">
                        Anulado{p.voidedByName ? ` por ${p.voidedByName}` : ''}: {p.voidReason}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={cn('font-medium', p.voidedAt && 'line-through')}>{formatCurrency(p.amount)}</span>
                    {onVoidPayment && !p.voidedAt && (
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onVoidPayment(p)}>
                        <Undo2 className="mr-1 h-3.5 w-3.5" />
                        Anular
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
