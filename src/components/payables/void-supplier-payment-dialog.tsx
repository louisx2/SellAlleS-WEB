'use client';

import { useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { usePayables } from '@/context/payables-provider';
import { formatCurrency } from '@/lib/utils';
import type { SupplierPayment } from '@/lib/types';

interface VoidSupplierPaymentDialogProps {
  payment: SupplierPayment;
  supplierName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Anular un pago a suplidor mal registrado. No se borra: la base lo marca
// anulado y el monto vuelve al balance de la factura. Aquí el dinero había
// SALIDO, así que si fue en efectivo regresa a la caja abierta de la sucursal.
export function VoidSupplierPaymentDialog({ payment, supplierName, open, onOpenChange }: VoidSupplierPaymentDialogProps) {
  const { voidPayment } = usePayables();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleVoid = async () => {
    if (!reason.trim()) {
      toast({ title: 'Falta el motivo', description: 'Escribe por qué se anula este pago.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const result = await voidPayment(payment.id, reason.trim());
      toast({
        title: 'Pago anulado',
        description: result.cashReturned
          ? `Se revirtió ${formatCurrency(result.amount)} y se registró la entrada de efectivo en la caja abierta.`
          : `Se revirtió ${formatCurrency(result.amount)}. La factura vuelve a deber ${formatCurrency(result.remainingBalance)}.`,
      });
      onOpenChange(false);
      setReason('');
    } catch (e: any) {
      toast({
        title: 'No se pudo anular el pago',
        description: e?.message ?? 'Error de conexión con el servidor.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular pago a suplidor</DialogTitle>
          <DialogDescription>
            Pago de <span className="font-semibold">{formatCurrency(payment.amount)}</span>
            {supplierName ? <> a {supplierName}</> : null} del{' '}
            {payment.date.toLocaleDateString('es-DO')}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p>
              La factura vuelve a deber este monto. El pago no se borra: queda en el historial
              marcado como anulado, con este motivo.
            </p>
            {payment.method === 'cash' && (
              <p className="mt-2 font-medium">
                Fue un pago en efectivo: si la sucursal usa caja, el dinero vuelve como entrada en
                la caja abierta, así que hay que tenerla abierta para anular.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="void-supplier-reason">Motivo de la anulación</Label>
            <Textarea
              id="void-supplier-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: se registró dos veces el mismo pago"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleVoid} disabled={saving || !reason.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
            Anular pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
