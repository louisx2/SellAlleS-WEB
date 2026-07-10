'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useLoans } from '@/context/loan-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatCurrency } from '@/lib/utils';
import { CustomerSearchDialog } from '@/components/pos/customer-search-dialog';
import type { Customer } from '@/lib/types';
import { PlusCircle, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface LoanDialogProps {
  children?: React.ReactNode;
}

const installmentOptions = [3, 6, 9, 12, 18, 24];

// Vista previa de interés simple mensual — calcada de FinancingDialog (POS) sin
// importarlo, a propósito: el módulo de préstamos no depende de financing-dialog.
// El monto real y el cronograma los calcula el servidor (trg_before_loan_checks).
export function LoanDialog({ children }: LoanDialogProps) {
  const { toast } = useToast();
  const { addLoan } = useLoans();
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const { profile } = useCompanyProfile();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [branchId, setBranchId] = useState('');
  const [principal, setPrincipal] = useState<string>('');
  const [downPayment, setDownPayment] = useState<string>('');
  const [interestRate, setInterestRate] = useState<string>(String(profile.defaultLoanInterestRate));
  const [installments, setInstallments] = useState(12);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);

  useEffect(() => {
    if (open) {
      setCustomer(null);
      setBranchId(appUser?.activeBranchId ?? '');
      setPrincipal('');
      setDownPayment('');
      setInterestRate(String(profile.defaultLoanInterestRate));
      setInstallments(12);
      setNotes('');
    }
  }, [open, appUser?.activeBranchId, profile.defaultLoanInterestRate]);

  const preview = useMemo(() => {
    const p = Number(principal) || 0;
    const dp = Number(downPayment) || 0;
    const rate = Number(interestRate) || 0;
    const toFinance = p - dp;
    if (toFinance <= 0 || installments <= 0) {
      return { toFinance: Math.max(toFinance, 0), installmentAmount: 0, totalWithInterest: p };
    }
    const interest = toFinance * (rate / 100) * installments;
    const financed = toFinance + interest;
    return { toFinance, installmentAmount: financed / installments, totalWithInterest: financed + dp };
  }, [principal, downPayment, interestRate, installments]);

  const isPrincipalInvalid = !principal || Number(principal) <= 0;
  const isDownPaymentInvalid = Number(downPayment) < 0 || Number(downPayment) >= (Number(principal) || 0);
  const canSubmit = !!customer && !!branchId && !isPrincipalInvalid && !isDownPaymentInvalid && preview.installmentAmount > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !customer) return;
    setSaving(true);
    try {
      const loan = await addLoan({
        branchId,
        customerId: customer.id,
        principal: Number(principal),
        interestRate: Number(interestRate) || 0,
        installmentsCount: installments,
        downPayment: Number(downPayment) || 0,
        notes: notes.trim() || undefined,
      });
      toast({ title: 'Préstamo creado', description: `${formatCurrency(Number(principal))} a ${customer.name}.` });
      setOpen(false);
      router.push(`/prestamos/${loan.id}`);
    } catch (err: any) {
      toast({ title: 'Error al crear el préstamo', description: err?.message ?? 'Inténtalo de nuevo.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo préstamo</DialogTitle>
            <DialogDescription>Préstamo de dinero a un cliente, con cuotas e interés.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Cliente</Label>
              {customer ? (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{customer.name}</p>
                    <p className="text-xs text-muted-foreground">{customer.phone}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setCustomerSearchOpen(true)}>Cambiar</Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setCustomerSearchOpen(true)}>
                  <User className="mr-2 h-4 w-4" /> Seleccionar cliente
                </Button>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Sucursal</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="Selecciona una sucursal" /></SelectTrigger>
                <SelectContent>
                  {activeBranches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="principal">Monto a prestar</Label>
                <Input id="principal" type="number" step="0.01" placeholder="0.00" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
                {isPrincipalInvalid && principal !== '' && <p className="text-xs text-destructive">Debe ser mayor que cero.</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="downPayment">Abono inicial (opcional)</Label>
                <Input id="downPayment" type="number" step="0.01" placeholder="0.00" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} />
                {isDownPaymentInvalid && <p className="text-xs text-destructive">No puede ser negativo ni igual/mayor al monto.</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="interestRate">Tasa de interés mensual (%)</Label>
                <Input id="interestRate" type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Cantidad de cuotas</Label>
                <Select value={String(installments)} onValueChange={(v) => setInstallments(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {installmentOptions.map((opt) => <SelectItem key={opt} value={String(opt)}>{opt} cuotas</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center text-lg font-bold bg-secondary p-3 rounded-md">
                <span className="text-primary">Cuota mensual:</span>
                <span className="text-primary">{formatCurrency(preview.installmentAmount)}</span>
              </div>
              <div className="flex justify-between"><span>Monto a financiar:</span><span>{formatCurrency(preview.toFinance)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total a pagar (con intereses):</span><span>{formatCurrency(preview.totalWithInterest)}</span></div>
              <p className="text-xs text-muted-foreground">Los montos y fechas definitivos los calcula el servidor al crear el préstamo.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || saving}>
              {saving ? 'Creando…' : <><PlusCircle className="mr-2 h-4 w-4" /> Crear préstamo</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerSearchDialog
        isOpen={customerSearchOpen}
        onOpenChange={setCustomerSearchOpen}
        onCustomerSelected={(c) => { setCustomer(c); setCustomerSearchOpen(false); }}
      />
    </>
  );
}
