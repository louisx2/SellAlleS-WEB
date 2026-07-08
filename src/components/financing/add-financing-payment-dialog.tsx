'use client';

import { useState, useEffect, useMemo } from 'react';
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
import type { PaymentMethod, Sale } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { PaymentReceiptDialog, type PaymentReceiptData } from '@/components/credit/payment-receipt-dialog';
import { Info, Loader2 } from 'lucide-react';

interface AddFinancingPaymentDialogProps {
  sale: Sale;
  children: React.ReactNode;
}

export function AddFinancingPaymentDialog({ sale, children }: AddFinancingPaymentDialogProps) {
  const { toast } = useToast();
  const { paySale } = useSales();
  const { profile } = useCompanyProfile();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [userBranch, setUserBranch] = useState('Desconocida');
  const [receipt, setReceipt] = useState<PaymentReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const status = useMemo(
    () => calculateFinancingStatus(sale, profile.lateFeeRate),
    [sale, profile.lateFeeRate]
  );

  useEffect(() => {
    if (open) {
        setAmount(status.paymentDue);
        setMethod('cash');
        setNotes('');
        const branch = localStorage.getItem('userBranch') || 'Desconocida';
        setUserBranch(branch);
    }
  }, [open, status.paymentDue]);

  const maxPayable = status.pendingBalance + status.lateFee;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paymentAmount = Number(amount);

    if (paymentAmount <= 0 || paymentAmount > maxPayable + 0.01) {
        toast({
            title: 'Monto inválido',
            description: `El abono debe ser mayor que cero y no exceder ${formatCurrency(maxPayable)} (deuda + mora).`,
            variant: 'destructive'
        });
        return;
    }

    setSaving(true);
    try {
      // La RPC aplica el abono en una sola transacción: mora primero, luego
      // capital a las cuotas, amount_paid y balance del cliente.
      const result = await paySale(sale.id, paymentAmount, method, userBranch, notes.trim() || undefined);

      toast({
          title: 'Abono registrado',
          description: `Se registró un abono de ${formatCurrency(paymentAmount)} para ${sale.customer?.name}.`,
      });

      setReceipt({
        result,
        customerName: sale.customer?.name ?? 'Cliente',
        method,
        date: new Date(),
        branchName: userBranch,
        userName: localStorage.getItem('userName') ?? undefined,
        notes: notes.trim() || undefined,
        saleId: sale.id,
      });
      setOpen(false);
      setReceiptOpen(true);
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
    <>
    <Dialog open={open} onOpenChange={setOpen}>
        {children}
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
            <DialogTitle>Registrar Abono a Financiamiento</DialogTitle>
            <DialogDescription>
                Cliente: <span className="font-semibold">{sale.customer?.name}</span><br />
                Balance Pendiente: <span className="font-semibold text-destructive">{formatCurrency(status.pendingBalance)}</span>
                {status.lateFee > 0 && (
                  <> · Mora: <span className="font-semibold text-destructive">{formatCurrency(status.lateFee)}</span></>
                )}
            </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
                <div className="space-y-4 py-4">
                    {status.isOverdue && (
                        <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-destructive">
                            <Info className="h-5 w-5 mt-0.5 shrink-0"/>
                            <div>
                                <p className="font-semibold">Este financiamiento está atrasado.</p>
                                <p className="text-sm">Mora por atraso: {formatCurrency(status.lateFee)} — se cobra primero.</p>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                          <Label htmlFor="amount">Monto a Pagar</Label>
                          <Input
                              id="amount"
                              name="amount"
                              type="number"
                              step="0.01"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                              required
                              placeholder={formatCurrency(status.paymentDue)}
                              />
                      </div>
                      <div className="space-y-2">
                          <Label htmlFor="method">Método de Pago</Label>
                          <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
                              <SelectTrigger id="method"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                  <SelectItem value="cash">Efectivo</SelectItem>
                                  <SelectItem value="card">Tarjeta</SelectItem>
                                  <SelectItem value="transfer">Transferencia</SelectItem>
                              </SelectContent>
                          </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="payment-notes">Notas (Opcional)</Label>
                        <Textarea
                            id="payment-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Ej: referencia de transferencia, acuerdo de pago…"
                        />
                    </div>
                     <p className="text-xs text-muted-foreground text-center">
                        Monto sugerido: <span className="font-semibold">{formatCurrency(status.paymentDue - status.lateFee)} (cuota)</span>
                        {status.lateFee > 0 && <> + <span className="font-semibold">{formatCurrency(status.lateFee)} (mora)</span></>}.
                     </p>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancelar</Button>
                    </DialogClose>
                    <Button type="submit" disabled={saving || !amount || Number(amount) <= 0}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar Abono
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>

    <PaymentReceiptDialog data={receipt} isOpen={receiptOpen} onOpenChange={setReceiptOpen} />
    </>
  );
}
