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
import { useSales } from '@/context/sales-provider';
import { useCustomers } from '@/context/customer-provider';
import { formatCurrency } from '@/lib/utils';
import type { CreditPayment } from '@/lib/types';

interface VoidPaymentDialogProps {
  payment: CreditPayment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama al terminar, para que la pantalla recargue su historial. */
  onVoided?: () => void;
}

// Anular un abono mal registrado (monto equivocado, cliente equivocado, cobro
// que no entró). No se borra: la base lo marca anulado y devuelve capital y
// mora a las cuotas exactas que los recibieron. Si el abono fue en efectivo y
// venía de una caja ya cerrada, el dinero sale de la caja de hoy.
export function VoidPaymentDialog({ payment, open, onOpenChange, onVoided }: VoidPaymentDialogProps) {
  const { voidPayment } = useSales();
  const { reload: reloadCustomers } = useCustomers();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleVoid = async () => {
    if (!reason.trim()) {
      toast({ title: 'Falta el motivo', description: 'Escribe por qué se anula este abono.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const result = await voidPayment(payment.id, reason.trim());
      await reloadCustomers();
      toast({
        title: 'Abono anulado',
        description: result.cashReturned
          ? `Se revirtió ${formatCurrency(result.amount)} y se registró la salida de efectivo en la caja abierta.`
          : `Se revirtió ${formatCurrency(result.amount)}. Las cuotas volvieron a su estado anterior.`,
      });
      onOpenChange(false);
      setReason('');
      onVoided?.();
    } catch (e: any) {
      toast({
        title: 'No se pudo anular el abono',
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
          <DialogTitle>Anular abono</DialogTitle>
          <DialogDescription>
            Abono de <span className="font-semibold">{formatCurrency(payment.amount)}</span> del{' '}
            {payment.date.toLocaleDateString('es-DO')}
            {payment.lateFeePaid > 0 && (
              <> (incluye {formatCurrency(payment.lateFeePaid)} de mora)</>
            )}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p>
              La deuda del cliente vuelve a subir y las cuotas regresan al estado que tenían.
              El abono no se borra: queda en el historial marcado como anulado, con este motivo.
            </p>
            {payment.method === 'cash' && (
              <p className="mt-2 font-medium">
                Fue un cobro en efectivo: si venía de una caja ya cerrada, la salida se registra
                en la caja abierta de esta sucursal.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="void-reason">Motivo de la anulación</Label>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: se digitó RD$50,000 en vez de RD$5,000"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleVoid} disabled={saving || !reason.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
            Anular abono
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
