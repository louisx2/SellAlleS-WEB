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
import type { Customer, PaymentMethod } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCustomers } from '@/context/customer-provider';
import { useSales } from '@/context/sales-provider';
import { formatCurrency } from '@/lib/utils';
import { PaymentReceiptDialog, type PaymentReceiptData } from './payment-receipt-dialog';
import { Loader2 } from 'lucide-react';

interface AddPaymentDialogProps {
  customer: Customer;
  children: React.ReactNode;
}

export function AddPaymentDialog({ customer, children }: AddPaymentDialogProps) {
  const { toast } = useToast();
  const { reload: reloadCustomers } = useCustomers();
  const { payCustomerDebt } = useSales();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [userBranch, setUserBranch] = useState('Desconocida');
  const [receipt, setReceipt] = useState<PaymentReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    if (open) {
        setAmount('');
        setMethod('cash');
        setNotes('');
        const branch = localStorage.getItem('userBranch') || 'Desconocida';
        setUserBranch(branch);
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paymentAmount = Number(amount);

    if (paymentAmount <= 0 || paymentAmount > customer.creditBalance) {
        toast({
            title: 'Monto inválido',
            description: 'El monto del abono no puede ser cero, negativo o mayor que la deuda.',
            variant: 'destructive'
        });
        return;
    }

    setSaving(true);
    try {
      // RPC atómica: registra el abono, lo aplica FIFO a las ventas a crédito
      // abiertas del cliente y actualiza su balance en una sola transacción.
      const result = await payCustomerDebt(customer.id, paymentAmount, method, userBranch, notes.trim() || undefined);
      await reloadCustomers();

      toast({
          title: 'Abono registrado',
          description: `Se registró un abono de ${formatCurrency(paymentAmount)} para ${customer.name}.`,
      });

      setReceipt({
        result,
        customerName: customer.name,
        method,
        date: new Date(),
        branchName: userBranch,
        userName: localStorage.getItem('userName') ?? undefined,
        notes: notes.trim() || undefined,
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
          <DialogTitle>Registrar Abono a Deuda</DialogTitle>
          <DialogDescription>
            Cliente: <span className="font-semibold">{customer.name}</span><br />
            Deuda Actual: <span className="font-semibold text-destructive">{formatCurrency(customer.creditBalance)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Monto</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  required
                  placeholder={formatCurrency(customer.creditBalance)}
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
              El abono se aplica automáticamente a las ventas a crédito más antiguas del cliente.
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
