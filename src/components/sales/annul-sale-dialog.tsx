'use client';

import { useState } from 'react';
import { Loader2, Ban } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useSales } from '@/context/sales-provider';
import { useProducts } from '@/context/product-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatCurrency } from '@/lib/utils';
import type { RefundMethod, Sale } from '@/lib/types';

interface AnnulSaleDialogProps {
  sale: Sale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const METHOD_LABEL: Record<RefundMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  none: 'Sin devolución de dinero',
};

// Anulación de una venta: la base emite la nota de crédito B04 (si la venta
// llevó NCF), repone el inventario y descuenta de caja si la devolución es en
// efectivo. En una venta a crédito o financiada además anula el abono inicial
// y le quita la deuda al cliente. Aquí solo se confirma y se muestra el resultado.
export function AnnulSaleDialog({ sale, open, onOpenChange }: AnnulSaleDialogProps) {
  const { annulSale } = useSales();
  const { reload: reloadProducts } = useProducts();
  const { profile } = useCompanyProfile();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  // Por defecto el dinero vuelve por donde entró. "Sin devolución" se elige a
  // propósito: es para la venta facturada por error, que nunca se cobró.
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(
    sale.paymentMethod === 'card' || sale.paymentMethod === 'transfer' ? sale.paymentMethod : 'cash'
  );
  const [saving, setSaving] = useState(false);

  // Venta a crédito o financiada: el dinero que entró es el abono inicial, y la
  // base lo devuelve por la misma vía en que se cobró (no se elige método).
  const isCredit = sale.paymentStatus !== 'paid';
  const downPayment = sale.amountPaid;
  const pendingDebt = Math.max(
    (sale.paymentStatus === 'in_financing' ? sale.financingDetails?.totalWithInterest ?? sale.total : sale.total)
      - sale.amountPaid,
    0,
  );
  const [creditRefund, setCreditRefund] = useState<'return' | 'none'>(downPayment > 0 ? 'return' : 'none');

  const handleAnnul = async () => {
    setSaving(true);
    try {
      const result = await annulSale(
        sale.id,
        reason,
        isCredit ? (creditRefund === 'none' ? 'none' : undefined) : refundMethod,
      );
      // El stock de los productos vendidos volvió a subir en la base.
      await reloadProducts();
      const sinDevolucion = result.refundMethod === 'none';
      const abono = result.paymentsVoided > 0
        ? ` Se anuló el abono inicial de ${formatCurrency(result.paymentsVoided)}.`
        : '';
      toast({
        title: 'Venta anulada',
        description: (result.ncf
          ? `Nota de crédito ${result.ncf} emitida por ${formatCurrency(result.total)}.`
            + (sinDevolucion ? ' No se devolvió dinero.' : '')
          : `Venta anulada por ${formatCurrency(result.total)}. El inventario fue repuesto`
            + (sinDevolucion ? ', sin devolución de dinero.' : '.'))
          + abono,
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'No se pudo anular la venta',
        description: error?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular venta</DialogTitle>
          <DialogDescription>
            Total {formatCurrency(sale.total)}
            {sale.ncf ? <> · NCF <span className="font-mono">{sale.ncf}</span></> : null}
            {sale.customer?.name ? <> · {sale.customer.name}</> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            El inventario de los productos vendidos será repuesto.
            {isCredit && (
              <>
                {' '}Se le quita al cliente la deuda pendiente de {formatCurrency(pendingDebt)}
                {downPayment > 0 && <> y se anula el abono inicial de {formatCurrency(downPayment)}</>}.
                Si la venta tiene abonos posteriores, anúlalos primero desde su detalle.
              </>
            )}
            {sale.ncf && profile.ncfEnabled
              ? ' Se emitirá una nota de crédito (B04) que referencia el NCF original: necesitas una secuencia B04 activa.'
              : ''}
            {' '}Esta acción no se puede deshacer.
          </div>

          {isCredit ? (
            downPayment > 0 && (
              <div className="space-y-2">
                <Label>¿Qué pasa con el abono inicial?</Label>
                <Select value={creditRefund} onValueChange={(v: 'return' | 'none') => setCreditRefund(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="return">Se le devuelve al cliente</SelectItem>
                    <SelectItem value="none">Sin devolución (el dinero nunca entró)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {creditRefund === 'return'
                    ? 'Se devuelve por la misma vía en que se cobró. Si fue en efectivo en una caja ya cerrada, sale de la caja abierta.'
                    : 'Para la venta que se facturó por error: el abono no se cuenta en la caja, pero no sale dinero.'}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <Label>¿Cómo se devuelve el dinero?</Label>
              <Select value={refundMethod} onValueChange={(v: RefundMethod) => setRefundMethod(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_LABEL) as RefundMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {refundMethod === 'cash' && (
                <p className="text-xs text-muted-foreground">
                  Con el módulo de Caja activo, la devolución sale de la caja abierta de la sucursal.
                </p>
              )}
              {refundMethod === 'none' && (
                <p className="text-xs text-muted-foreground">
                  Para la venta que se facturó por error y nunca se cobró (por ejemplo, cobrada dos
                  veces por un doble clic). Se repone el inventario, pero no sale dinero de la caja.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="annul-reason">Motivo (opcional)</Label>
            <Textarea
              id="annul-reason"
              placeholder="Ej: error de digitación, cliente devolvió el producto…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={handleAnnul} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
            Anular venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
