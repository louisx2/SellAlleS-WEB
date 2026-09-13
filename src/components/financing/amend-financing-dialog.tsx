'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, ArrowRight } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useSales } from '@/context/sales-provider';
import { useCustomers } from '@/context/customer-provider';
import { formatCurrency } from '@/lib/utils';
import {
  FREQUENCY_LABEL, INTEREST_MODE_LABEL, installmentLabel, monthsFor, rateLabel,
  type InterestMode, type PaymentFrequency,
} from '@/lib/frequency';
import type { Sale } from '@/lib/types';

interface AmendFinancingDialogProps {
  sale: Sale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama al terminar, para que la pantalla recargue su bitácora. */
  onAmended?: () => void;
}

const MAX_INSTALLMENTS = 60;

// Corregir un plan mal digitado (la tasa que iba 7 y se tecleó 8). No es
// renegociar: el abono inicial, la mora y las fechas de vencimiento no se
// tocan — solo se recalcula lo que depende de los parámetros del plan. Si el
// cliente ya abonó a una cuota, la base lo rechaza: hay que anular esos abonos
// primero, porque repreciar mueve el monto de todas las cuotas y no habría
// forma de cuadrar lo ya pagado.
export function AmendFinancingDialog({ sale, open, onOpenChange, onAmended }: AmendFinancingDialogProps) {
  const { amendFinancing } = useSales();
  const { reload: reloadCustomers } = useCustomers();
  const { toast } = useToast();

  const fin = sale.financingDetails;
  const [rate, setRate] = useState<string>('');
  const [installments, setInstallments] = useState<string>('');
  const [frequency, setFrequency] = useState<PaymentFrequency>('monthly');
  const [interestMode, setInterestMode] = useState<InterestMode>('monthly_prorated');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Abre siempre con lo que el plan dice HOY: corregir es cambiar un campo,
  // no rellenar el formulario entero de nuevo.
  useEffect(() => {
    if (!open || !fin) return;
    setRate(String(fin.interestRate));
    setInstallments(String(fin.installments));
    setFrequency(fin.frequency ?? 'monthly');
    setInterestMode(fin.interestMode ?? 'monthly_prorated');
    setReason('');
  }, [open, fin]);

  // Lo que el cliente ya pagó a las cuotas (el abono inicial no cuenta: es
  // parte de la venta, no un abono al plan).
  const paidToPlan = useMemo(
    () => (sale.installments ?? []).reduce((acc, c) => acc + c.paidAmount + c.lateFeePaid, 0),
    [sale.installments]
  );

  const n = Number(installments) || 0;
  const numericRate = Number(rate);
  const isRateInvalid = rate === '' || Number.isNaN(numericRate) || numericRate < 0 || numericRate > 100;
  const isInstallmentsInvalid =
    installments === '' || !Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS;

  // Vista previa. El monto que queda grabado lo calcula el servidor con
  // `financing_plan`; esto replica la misma fórmula solo para mostrarla.
  const preview = useMemo(() => {
    const downPayment = fin?.downPayment ?? 0;
    const principal = Math.round((sale.total - downPayment) * 100) / 100;
    const oldInterest = (fin?.totalWithInterest ?? sale.total) - sale.total;

    if (isRateInvalid || isInstallmentsInvalid) {
      return { principal, oldInterest, interest: 0, debt: 0, installment: 0, months: 0, valid: false };
    }

    const months = monthsFor(frequency, n, interestMode);
    const interest = Math.round(principal * (numericRate / 100) * months * 100) / 100;
    const debt = principal + interest;

    return {
      principal,
      oldInterest,
      interest,
      debt,
      installment: Math.round((debt / n) * 100) / 100,
      months,
      valid: true,
    };
  }, [sale.total, fin, frequency, interestMode, n, numericRate, isRateInvalid, isInstallmentsInvalid]);

  const hasChanges =
    !!fin && (
      numericRate !== fin.interestRate ||
      n !== fin.installments ||
      frequency !== (fin.frequency ?? 'monthly') ||
      interestMode !== (fin.interestMode ?? 'monthly_prorated')
    );

  const handleSave = async () => {
    if (!reason.trim()) {
      toast({ title: 'Falta el motivo', description: 'Escribe por qué se corrige este plan.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const result = await amendFinancing({
        saleId: sale.id,
        interestRate: numericRate,
        installments: n,
        frequency,
        interestMode,
        reason: reason.trim(),
      });
      await reloadCustomers();
      const diff = result.interestAfter - result.interestBefore;
      toast({
        title: 'Plan corregido',
        description: diff === 0
          ? 'Las cuotas se regeneraron con los nuevos términos.'
          : `El interés ${diff < 0 ? 'bajó' : 'subió'} ${formatCurrency(Math.abs(diff))}. Nueva cuota: ${formatCurrency(result.after.installmentAmount)}.`,
      });
      onOpenChange(false);
      onAmended?.();
    } catch (e: any) {
      toast({
        title: 'No se pudo corregir el plan',
        description: e?.message ?? 'Error de conexión con el servidor.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!fin) return null;

  const blocked = paidToPlan > 0;
  const interestDiff = preview.interest - preview.oldInterest;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corregir plan de financiamiento</DialogTitle>
          <DialogDescription>
            Venta del {new Date(sale.createdAt).toLocaleDateString('es-DO')} ·{' '}
            {sale.customer?.name ?? 'Consumidor Final'}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">Este plan ya tiene {formatCurrency(paidToPlan)} cobrados.</p>
            <p className="mt-1">
              Corregir el plan cambia el monto de todas las cuotas, y entonces lo ya pagado no
              cuadraría con ninguna. Anula primero esos abonos desde el historial de abonos y
              vuelve aquí.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              Esto corrige un error de digitación, no renegocia la venta. El abono inicial
              ({formatCurrency(fin.downPayment ?? 0)}), la mora del plan y las fechas de
              vencimiento se quedan como están; se recalculan el interés y las cuotas.
            </div>

            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amend-rate">{rateLabel(interestMode)}</Label>
                  <Input
                    id="amend-rate"
                    type="text"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*(\.\d{0,2})?$/.test(v) && v.length <= 6) setRate(v);
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                  {isRateInvalid && <p className="text-xs text-destructive">La tasa debe ir de 0 a 100.</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amend-installments">Cantidad de Cuotas</Label>
                  <Input
                    id="amend-installments"
                    type="text"
                    inputMode="numeric"
                    value={installments}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d{0,2}$/.test(v)) setInstallments(v);
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                  {isInstallmentsInvalid && (
                    <p className="text-xs text-destructive">Entre 1 y {MAX_INSTALLMENTS} cuotas.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amend-frequency">Frecuencia de Pago</Label>
                  <Select value={frequency} onValueChange={(v: PaymentFrequency) => setFrequency(v)}>
                    <SelectTrigger id="amend-frequency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">{FREQUENCY_LABEL.weekly}</SelectItem>
                      <SelectItem value="biweekly">{FREQUENCY_LABEL.biweekly}</SelectItem>
                      <SelectItem value="monthly">{FREQUENCY_LABEL.monthly}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amend-mode">Cómo se cobra el interés</Label>
                  <Select value={interestMode} onValueChange={(v: InterestMode) => setInterestMode(v)}>
                    <SelectTrigger id="amend-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly_prorated">{INTEREST_MODE_LABEL.monthly_prorated}</SelectItem>
                      <SelectItem value="per_installment">{INTEREST_MODE_LABEL.per_installment}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amend-reason">Motivo de la corrección</Label>
                <Textarea
                  id="amend-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej: se digitó 8% de interés en vez de 7%"
                />
              </div>
            </div>

            <Separator />

            {/* El antes y el después, uno al lado del otro: es lo que el
                administrador necesita ver para decidir, y lo que después le va
                a explicar al cliente. */}
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-muted-foreground">
                <span className="text-center">Ahora</span>
                <span />
                <span className="text-center font-medium text-foreground">Quedaría</span>
              </div>

              <Row
                label="Interés"
                before={formatCurrency(preview.oldInterest)}
                after={preview.valid ? formatCurrency(preview.interest) : '—'}
              />
              <Row
                label={installmentLabel(frequency)}
                before={formatCurrency(fin.installmentAmount)}
                after={preview.valid ? formatCurrency(preview.installment) : '—'}
                strong
              />
              <Row
                label="Cuotas"
                before={`${fin.installments}`}
                after={preview.valid ? `${n}` : '—'}
              />
              <Row
                label="Deuda del cliente"
                before={formatCurrency((fin.totalWithInterest ?? sale.total) - sale.amountPaid)}
                after={preview.valid ? formatCurrency(preview.debt) : '—'}
              />

              {preview.valid && interestDiff !== 0 && (
                <p className={interestDiff < 0 ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                  El cliente {interestDiff < 0 ? 'pagaría' : 'debería'} {formatCurrency(Math.abs(interestDiff))}{' '}
                  {interestDiff < 0 ? 'menos' : 'más'} de interés
                  {preview.months > 0 && ` (${Number.isInteger(preview.months) ? preview.months : preview.months.toFixed(1)} ${preview.months === 1 ? 'mes' : 'meses'})`}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Los montos definitivos los calcula el servidor; esto es la vista previa.
              </p>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            {blocked ? 'Entendido' : 'Cancelar'}
          </Button>
          {!blocked && (
            <Button
              onClick={handleSave}
              disabled={saving || !reason.trim() || isRateInvalid || isInstallmentsInvalid || !hasChanges}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
              Corregir plan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, before, after, strong }: {
  label: string; before: string; after: string; strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className={`text-center ${strong ? 'font-semibold' : ''} text-muted-foreground line-through`}>
          {before}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={`text-center ${strong ? 'font-bold text-primary text-base' : 'font-medium'}`}>
          {after}
        </span>
      </div>
    </div>
  );
}
