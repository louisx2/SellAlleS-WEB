'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PaymentMethod, Loan } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useAuth } from '@/context/auth-provider';
import { useModules } from '@/context/modules-provider';
import { useCaja } from '@/context/caja-provider';
import { PaymentReceiptDialog, type PaymentReceiptData } from '@/components/credit/payment-receipt-dialog';
import { Info, Loader2 } from 'lucide-react';

interface RegisterLoanPaymentDialogProps {
  loan: Loan;
  children: React.ReactNode;
}

export function RegisterLoanPaymentDialog({ loan, children }: RegisterLoanPaymentDialogProps) {
  const { toast } = useToast();
  const { payLoan } = useLoans();
  const { profile } = useCompanyProfile();
  const { appUser } = useAuth();
  const { isModuleEnabled } = useModules();
  const { isOpen: isCajaOpen } = useCaja();
  const cashBlocked = isModuleEnabled('caja') && !isCajaOpen;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<PaymentReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const status = useMemo(() => calculateLoanStatus(loan, profile.loanLateFeeRate), [loan, profile.loanLateFeeRate]);

  useEffect(() => {
    if (open) {
      setAmount(status.paymentDue);
      setMethod(cashBlocked ? 'card' : 'cash');
      setReference('');
      setNotes('');
    }
  }, [open, status.paymentDue, cashBlocked]);

  const maxPayable = status.pendingBalance + status.lateFee;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paymentAmount = Number(amount);

    if (paymentAmount <= 0 || paymentAmount > maxPayable + 0.01) {
      toast({
        title: 'Monto inválido',
        description: `El abono debe ser mayor que cero y no exceder ${formatCurrency(maxPayable)} (deuda + mora).`,
        variant: 'destructive',
      });
      return;
    }

    if (method === 'cash' && cashBlocked) {
      toast({ title: 'Caja cerrada', description: 'Abre la caja de esta sucursal para cobrar en efectivo.', variant: 'destructive' });
      return;
    }
    if (method === 'transfer' && !reference.trim()) {
      toast({ title: 'Falta la referencia', description: 'Indica la referencia de la transferencia.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const result = await payLoan(loan.id, paymentAmount, method, appUser?.activeBranchId, notes.trim() || undefined, reference.trim() || undefined);
      toast({
        title: 'Abono registrado',
        description: `Se registró un abono de ${formatCurrency(result.amount)} para ${loan.customer?.name ?? 'el cliente'}.`,
      });
      // Recibo imprimible del abono (mapea LoanPaymentResult al formato del recibo).
      setReceipt({
        result: {
          paymentId: result.paymentId,
          amount: result.amount,
          lateFeePaid: result.lateFeePaid,
          principalPaid: result.principalPaid,
          remainingBalance: result.remainingBalance,
          installmentsPaid: result.installmentsPaid,
          installmentsTotal: result.installmentsTotal,
          customerBalance: null,
        },
        customerName: loan.customer?.name ?? 'Cliente',
        method,
        date: new Date(),
        branchName: (typeof window !== 'undefined' && localStorage.getItem('userBranch')) || 'Sucursal',
        userName: (typeof window !== 'undefined' && localStorage.getItem('userName')) || undefined,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      setReceiptOpen(true);
    } catch (e: any) {
      toast({ title: 'No se pudo registrar el abono', description: e?.message ?? 'Error de conexión con el servidor.', variant: 'destructive' });
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
          <DialogTitle>Registrar Abono a Préstamo</DialogTitle>
          <DialogDescription>
            Cliente: <span className="font-semibold">{loan.customer?.name ?? 'Cliente'}</span><br />
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
                <Info className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Este préstamo está atrasado.</p>
                  <p className="text-sm">Mora por atraso: {formatCurrency(status.lateFee)} — se cobra primero.</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Monto a Pagar</Label>
                <Input
                  id="amount" name="amount" type="number" step="0.01"
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
                    <SelectItem value="cash" disabled={cashBlocked}>Efectivo</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {cashBlocked && (
              <p className="text-xs text-amber-600 dark:text-amber-400">No hay caja abierta en esta sucursal: no puedes cobrar en efectivo.</p>
            )}
            {(method === 'transfer' || method === 'card') && (
              <div className="space-y-2">
                <Label htmlFor="payment-reference">{method === 'transfer' ? 'Referencia de transferencia' : 'Referencia / aprobación'}</Label>
                <Input id="payment-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'transfer' ? 'No. de transferencia' : 'No. de aprobación'} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="payment-notes">Notas (Opcional)</Label>
              <Textarea id="payment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: acuerdo de pago…" />
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
            <Button type="submit" disabled={saving || !amount || Number(amount) <= 0 || (method === 'cash' && cashBlocked) || (method === 'transfer' && !reference.trim())}>
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
