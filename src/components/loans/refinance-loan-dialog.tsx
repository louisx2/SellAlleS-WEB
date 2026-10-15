'use client';

import { useEffect, useState } from 'react';
import { addDays } from 'date-fns';
import { Loader2, RefreshCw } from 'lucide-react';
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
import { useLoans } from '@/context/loan-provider';
import { formatCurrency } from '@/lib/utils';
import { FREQUENCY_LABEL, type PaymentFrequency } from '@/lib/frequency';
import { parseYmd, toYmd } from '@/lib/financing-schedule';
import { fetchRefinanceQuote, previewRefinancePlan, refinanceBase } from '@/lib/refinance';
import { RefinanceQuoteSummary } from '@/components/refinance/refinance-quote-summary';
import { RefinanceOptions } from '@/components/refinance/refinance-options';
import { RefinanceComparison } from '@/components/refinance/refinance-comparison';
import type { Loan, RefinanceBaseMode, RefinanceLateFeeAction, RefinanceQuote } from '@/lib/types';

interface RefinanceLoanDialogProps {
  loan: Loan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recibe el préstamo nuevo, para que la pantalla lo abra con su ticket. */
  onRefinanced: (newLoanId: string) => void;
}

const MAX_INSTALLMENTS = 60;

// Refinanciar un préstamo es cerrarlo y abrir uno nuevo con lo que se debe:
// alargar el plazo, bajar la cuota o renovarlo entregando dinero adicional
// (que, como un desembolso normal, no pasa por caja). Los préstamos no tienen
// modo de interés: la tasa es mensual y se prorratea a la duración del plan.
export function RefinanceLoanDialog({ loan, open, onOpenChange, onRefinanced }: RefinanceLoanDialogProps) {
  const { refinanceLoan } = useLoans();
  const { toast } = useToast();

  const [quote, setQuote] = useState<RefinanceQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState<RefinanceBaseMode>('capital');
  const [lateFee, setLateFee] = useState<RefinanceLateFeeAction | null>(null);
  const [additional, setAdditional] = useState('0');
  const [rate, setRate] = useState('');
  const [installments, setInstallments] = useState('');
  const [frequency, setFrequency] = useState<PaymentFrequency>('monthly');
  const [firstDue, setFirstDue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Cada vez que se abre, la cotización de hoy y los términos del préstamo.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setQuote(null);
    setLoadError(null);
    setBase('capital');
    setLateFee(null);
    setAdditional('0');
    setFirstDue('');
    setReason('');
    fetchRefinanceQuote('loan', loan.id)
      .then((q) => {
        if (!alive) return;
        setQuote(q);
        setRate(String(q.terms.interestRate));
        setInstallments(String(q.terms.installments));
        setFrequency(q.terms.frequency);
      })
      .catch((e: any) => alive && setLoadError(e?.message ?? 'No se pudo calcular lo que se debe.'));
    return () => { alive = false; };
  }, [open, loan.id]);

  const n = Number(installments) || 0;
  const numericRate = Number(rate);
  const numericAdditional = additional === '' ? 0 : Number(additional);
  const isRateInvalid = rate === '' || Number.isNaN(numericRate) || numericRate < 0 || numericRate > 100;
  const isInstallmentsInvalid = installments === '' || !Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS;
  const isAdditionalInvalid = Number.isNaN(numericAdditional) || numericAdditional < 0;
  const minFirstDue = quote ? toYmd(addDays(parseYmd(quote.today), 1)) : '';
  const isFirstDueInvalid = !!firstDue && !!minFirstDue && firstDue < minFirstDue;

  const amounts = quote && !isAdditionalInvalid ? refinanceBase(quote, base, lateFee, numericAdditional) : null;
  const plan = amounts && !isRateInvalid && !isInstallmentsInvalid
    ? previewRefinancePlan(amounts.principal, numericRate, n, frequency, 'monthly_prorated')
    : null;

  const openInstallments = (loan.installments ?? []).filter((c) => c.status !== 'paid');
  const needsLateFee = !!quote && quote.lateFeeDue > 0 && !lateFee;
  const canSave =
    !!quote && !!plan && !!amounts && amounts.principal > 0 && !needsLateFee &&
    !isFirstDueInvalid && !!reason.trim() && !saving;

  const handleSave = async () => {
    if (!quote || !canSave) return;
    setSaving(true);
    try {
      const result = await refinanceLoan({
        loanId: loan.id,
        baseMode: base,
        lateFeeAction: quote.lateFeeDue > 0 ? lateFee : null,
        additional: numericAdditional,
        interestRate: numericRate,
        installments: n,
        frequency,
        firstDueDate: firstDue || undefined,
        reason: reason.trim(),
        expectedBalance: quote.pendingBalance,
        expectedLateFee: quote.lateFeeDue,
      });
      toast({
        title: 'Préstamo refinanciado',
        description: `Préstamo nuevo por ${formatCurrency(result.newPrincipal)}, cuota de ${formatCurrency(result.installmentAmount)}.`,
      });
      onOpenChange(false);
      onRefinanced(result.newLoanId);
    } catch (e: any) {
      toast({
        title: 'No se pudo refinanciar',
        description: e?.message ?? 'Error de conexión con el servidor.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refinanciar préstamo</DialogTitle>
          <DialogDescription>
            Préstamo del {loan.createdAt.toLocaleDateString('es-DO')} · {loan.customer?.name ?? 'Cliente'}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">{loadError}</div>
        ) : !quote ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calculando lo que se debe…
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              Este préstamo se cierra y se abre uno nuevo con lo que se debe, que arranca hoy con la
              mora vigente de la empresa ({quote.newLateFee.rate}%). Sus abonos ya no se podrán anular.
            </div>

            <RefinanceQuoteSummary quote={quote} />
            <RefinanceOptions
              quote={quote}
              base={base}
              onBaseChange={setBase}
              lateFee={lateFee}
              onLateFeeChange={setLateFee}
            />

            <div className="space-y-2 text-sm">
              <Label htmlFor="refi-additional">Dinero adicional a entregar (RD$)</Label>
              <Input
                id="refi-additional"
                type="text"
                inputMode="decimal"
                value={additional}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d*(\.\d{0,2})?$/.test(v) && v.length <= 12) setAdditional(v);
                }}
                onFocus={(e) => e.target.select()}
              />
              <p className="text-xs text-muted-foreground">
                0 si solo se cambian los términos. Se suma al capital del préstamo nuevo y no pasa por caja.
              </p>
            </div>

            <Separator />

            <div className="grid gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="refi-rate">Tasa mensual (%)</Label>
                  <Input
                    id="refi-rate"
                    type="text"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*(\.\d{0,2})?$/.test(v) && v.length <= 6) setRate(v);
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="refi-installments">Cuotas</Label>
                  <Input
                    id="refi-installments"
                    type="text"
                    inputMode="numeric"
                    value={installments}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d{0,2}$/.test(v)) setInstallments(v);
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="refi-frequency">Frecuencia</Label>
                  <Select value={frequency} onValueChange={(v: PaymentFrequency) => setFrequency(v)}>
                    <SelectTrigger id="refi-frequency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">{FREQUENCY_LABEL.weekly}</SelectItem>
                      <SelectItem value="biweekly">{FREQUENCY_LABEL.biweekly}</SelectItem>
                      <SelectItem value="monthly">{FREQUENCY_LABEL.monthly}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {isRateInvalid && <p className="text-xs text-destructive">La tasa debe ir de 0 a 100.</p>}
              {isInstallmentsInvalid && (
                <p className="text-xs text-destructive">Entre 1 y {MAX_INSTALLMENTS} cuotas.</p>
              )}

              <div className="space-y-2">
                <Label htmlFor="refi-first-due">Primera cuota (opcional)</Label>
                <Input
                  id="refi-first-due"
                  type="date"
                  min={minFirstDue}
                  value={firstDue}
                  onChange={(e) => setFirstDue(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Vacío = un período después de hoy; las demás siguen la frecuencia.
                </p>
                {isFirstDueInvalid && (
                  <p className="text-xs text-destructive">La primera cuota tiene que caer después de hoy.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="refi-reason">Motivo de la refinanciación</Label>
                <Textarea
                  id="refi-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej: renovación con RD$5,000 adicionales"
                />
              </div>
            </div>

            <Separator />

            <RefinanceComparison
              before={{
                installment: openInstallments[0]?.amount ?? 0,
                installmentsLeft: openInstallments.length,
                balance: quote.pendingBalance,
              }}
              after={plan && amounts ? { principal: amounts.principal, ...plan, n } : null}
              cancelledInterest={base === 'capital' ? quote.unearnedInterest : 0}
            />
            {amounts && numericAdditional > 0 && (
              <p className="text-sm">
                Se le entregan <span className="font-semibold">{formatCurrency(numericAdditional)}</span> al cliente;
                {' '}{formatCurrency(amounts.carried)} vienen del préstamo actual.
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          {quote && (
            <Button onClick={handleSave} disabled={!canSave}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refinanciar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
