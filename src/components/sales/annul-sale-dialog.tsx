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
import type { PaymentMethod, Sale } from '@/lib/types';

interface AnnulSaleDialogProps {
  sale: Sale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

// Anulación de una venta pagada: la base emite la nota de crédito B04 (si la
// venta llevó NCF), repone el inventario y descuenta de caja si la devolución
// es en efectivo. Aquí solo se confirma y se muestra el resultado.
export function AnnulSaleDialog({ sale, open, onOpenChange }: AnnulSaleDialogProps) {
  const { annulSale } = useSales();
  const { reload: reloadProducts } = useProducts();
  const { profile } = useCompanyProfile();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(
    sale.paymentMethod === 'card' || sale.paymentMethod === 'transfer' ? sale.paymentMethod : 'cash'
  );
  const [saving, setSaving] = useState(false);

  const handleAnnul = async () => {
    setSaving(true);
    try {
      const result = await annulSale(sale.id, reason, refundMethod);
      // El stock de los productos vendidos volvió a subir en la base.
      await reloadProducts();
      toast({
        title: 'Venta anulada',
        description: result.ncf
          ? `Nota de crédito ${result.ncf} emitida por ${formatCurrency(result.total)}.`
          : `Venta anulada por ${formatCurrency(result.total)}. El inventario fue repuesto.`,
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
            {sale.ncf && profile.ncfEnabled
              ? ' Se emitirá una nota de crédito (B04) que referencia el NCF original: necesitas una secuencia B04 activa.'
              : ''}
            {' '}Esta acción no se puede deshacer.
          </div>

          <div className="space-y-2">
            <Label>¿Cómo se devuelve el dinero?</Label>
            <Select value={refundMethod} onValueChange={(v: PaymentMethod) => setRefundMethod(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {refundMethod === 'cash' && (
              <p className="text-xs text-muted-foreground">
                Con el módulo de Caja activo, la devolución sale de la caja abierta de la sucursal.
              </p>
            )}
          </div>

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
