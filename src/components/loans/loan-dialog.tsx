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
import type { Customer, LoanFrequency } from '@/lib/types';
import { HandCoins, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface LoanDialogProps {
  children?: React.ReactNode;
}

const FREQUENCY_LABEL: Record<LoanFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

// Cuotas por mes según la frecuencia; para prorratear la tasa mensual a la
// duración real del préstamo (mismo cálculo que trg_before_loan_checks).
const PER_MONTH: Record<LoanFrequency, number> = { weekly: 4, biweekly: 2, monthly: 1 };

// Diálogo de prestamista: presto RD$X a una tasa mensual y el cliente lo paga
// en cuotas semanales/quincenales/mensuales. Sin "abono inicial" — el dinero
// sale hacia el cliente, no al revés. El servidor recalcula todo al guardar.
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
  const [interestRate, setInterestRate] = useState<string>(String(profile.defaultLoanInterestRate));
  const [frequency, setFrequency] = useState<LoanFrequency>('monthly');
  const [installments, setInstallments] = useState<string>('12');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);

  useEffect(() => {
    if (open) {
      setCustomer(null);
      setBranchId(appUser?.activeBranchId ?? '');
      setPrincipal('');
      setInterestRate(String(profile.defaultLoanInterestRate));
      setFrequency('monthly');
      setInstallments('12');
      setNotes('');
    }
  }, [open, appUser?.activeBranchId, profile.defaultLoanInterestRate]);

  const preview = useMemo(() => {
    const p = Number(principal) || 0;
    const rate = Number(interestRate) || 0;
    const n = Number(installments) || 0;
    if (p <= 0 || n <= 0) {
      return { interest: 0, total: p, installmentAmount: 0, months: 0 };
    }
    const months = n / PER_MONTH[frequency];
    const interest = p * (rate / 100) * months;
    const total = p + interest;
    return { interest, total, installmentAmount: total / n, months };
  }, [principal, interestRate, installments, frequency]);

  const nInstallments = Number(installments) || 0;
  const isPrincipalInvalid = !principal || Number(principal) <= 0;
  const isInstallmentsInvalid = nInstallments < 1 || nInstallments > 60;
  const canSubmit = !!customer && !!branchId && !isPrincipalInvalid && !isInstallmentsInvalid && preview.installmentAmount > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !customer) return;
    setSaving(true);
    try {
      const loan = await addLoan({
        branchId,
        customerId: customer.id,
        principal: Number(principal),
        interestRate: Number(interestRate) || 0,
        installmentsCount: nInstallments,
        paymentFrequency: frequency,
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
            <DialogDescription>Dinero que entregas al cliente; lo recuperas en cuotas con interés.</DialogDescription>
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
                <Label htmlFor="interestRate">Interés mensual (%)</Label>
                <Input id="interestRate" type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Frecuencia de pago</Label>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as LoanFrequency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="biweekly">Quincenal</SelectItem>
                    <SelectItem value="monthly">Mensual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="installments">Cantidad de cuotas</Label>
                <Input
                  id="installments" type="number" min="1" max="60" step="1"
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                />
                {isInstallmentsInvalid && installments !== '' && <p className="text-xs text-destructive">Entre 1 y 60 cuotas.</p>}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ej: garantía, referencia, acuerdo…" />
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center text-lg font-bold bg-secondary p-3 rounded-md">
                <span className="text-primary">Cuota {FREQUENCY_LABEL[frequency].toLowerCase()}:</span>
                <span className="text-primary">{formatCurrency(preview.installmentAmount)}</span>
              </div>
              <div className="flex justify-between"><span>Prestas:</span><span>{formatCurrency(Number(principal) || 0)}</span></div>
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                <span>Tu ganancia (interés):</span><span>{formatCurrency(preview.interest)}</span>
              </div>
              <div className="flex justify-between font-semibold"><span>Total que te pagarán:</span><span>{formatCurrency(preview.total)}</span></div>
              <p className="text-xs text-muted-foreground">
                Duración: ~{preview.months.toFixed(1).replace('.0', '')} {preview.months === 1 ? 'mes' : 'meses'} · Los montos y fechas definitivos los calcula el servidor.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || saving}>
              {saving ? 'Creando…' : <><HandCoins className="mr-2 h-4 w-4" /> Prestar</>}
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
