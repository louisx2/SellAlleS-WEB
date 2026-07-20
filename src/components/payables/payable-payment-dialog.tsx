'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PaymentMethod, SupplierInvoice } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { usePayables } from '@/context/payables-provider';
import { useModules } from '@/context/modules-provider';
import { useCaja } from '@/context/caja-provider';
import { formatCurrency } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface PayablePaymentDialogProps {
  invoice: SupplierInvoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PayablePaymentDialog({ invoice, open, onOpenChange }: PayablePaymentDialogProps) {
  const { toast } = useToast();
  const { payInvoice } = usePayables();
  const { isModuleEnabled } = useModules();
  const { isOpen: isCajaOpen } = useCaja();
  // Con el módulo de caja activo, el efectivo sale de la caja de la sucursal:
  // sin caja abierta no se puede pagar en efectivo (la RPC también lo valida).
  const cashBlocked = isModuleEnabled('caja') && !isCajaOpen;
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [userBranch, setUserBranch] = useState('Desconocida');

  const balance = Math.max(invoice.balance, 0);
  const supplierName = invoice.supplier?.name ?? '—';

  useEffect(() => {
    if (open) {
      setAmount('');
      setMethod(cashBlocked ? 'card' : 'cash');
      setReference('');
      setNotes('');
      setUserBranch(localStorage.getItem('userBranch') || 'Desconocida');
    }
  }, [open, cashBlocked]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paymentAmount = Number(amount);

    if (paymentAmount <= 0 || paymentAmount > balance) {
      toast({
        title: 'Monto inválido',
        description: 'El abono no puede ser cero, negativo ni mayor que el balance pendiente.',
        variant: 'destructive',
      });
      return;
    }
    if (method === 'cash' && cashBlocked) {
      toast({ title: 'Caja cerrada', description: 'Abre la caja de esta sucursal para pagar en efectivo.', variant: 'destructive' });
      return;
    }
    if (method === 'transfer' && !reference.trim()) {
      toast({ title: 'Falta la referencia', description: 'Indica la referencia de la transferencia.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const result = await payInvoice(invoice.id, paymentAmount, method, userBranch, notes.trim() || undefined, reference.trim() || undefined);
      toast({
        title: result.status === 'paid' ? 'Factura saldada' : 'Abono registrado',
        description: result.status === 'paid'
          ? `La factura de ${supplierName} quedó saldada.`
          : `Abono de ${formatCurrency(paymentAmount)} a ${supplierName}. Balance restante: ${formatCurrency(result.remainingBalance)}.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'No se pudo registrar el abono',
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
          <DialogTitle>Registrar Abono a Suplidor</DialogTitle>
          <DialogDescription>
            Suplidor: <span className="font-semibold">{supplierName}</span><br />
            Balance Pendiente: <span className="font-semibold text-destructive">{formatCurrency(balance)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="payable-amount">Monto</Label>
                <Input
                  id="payable-amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  required
                  placeholder={formatCurrency(balance)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payable-method">Método de Pago</Label>
                <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
                  <SelectTrigger id="payable-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash" disabled={cashBlocked}>Efectivo</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {cashBlocked && (
              <p className="text-xs text-amber-600 dark:text-amber-400">No hay caja abierta en esta sucursal: no puedes pagar en efectivo.</p>
            )}
            {(method === 'transfer' || method === 'card') && (
              <div className="space-y-2">
                <Label htmlFor="payable-reference">{method === 'transfer' ? 'Referencia de transferencia' : 'Referencia / aprobación'}</Label>
                <Input id="payable-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'transfer' ? 'No. de transferencia' : 'No. de aprobación'} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="payable-notes">Notas (Opcional)</Label>
              <Textarea
                id="payable-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: pago parcial acordado…"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !amount || Number(amount) <= 0 || (method === 'cash' && cashBlocked) || (method === 'transfer' && !reference.trim())}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar Abono
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
