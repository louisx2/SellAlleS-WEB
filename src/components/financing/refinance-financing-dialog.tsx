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
import { useSales } from '@/context/sales-provider';
import { useCustomers } from '@/context/customer-provider';
import { formatCurrency } from '@/lib/utils';
import {
  FREQUENCY_LABEL, INTEREST_MODE_LABEL, rateLabel, type InterestMode, type PaymentFrequency,
} from '@/lib/frequency';
import { parseYmd, toYmd } from '@/lib/financing-schedule';
import { fetchRefinanceQuote, previewRefinancePlan, refinanceBase } from '@/lib/refinance';
import { RefinanceQuoteSummary } from '@/components/refinance/refinance-quote-summary';
import { RefinanceOptions } from '@/components/refinance/refinance-options';
import { RefinanceComparison } from '@/components/refinance/refinance-comparison';
import type { RefinanceBaseMode, RefinanceLateFeeAction, RefinanceQuote, Sale } from '@/lib/types';

interface RefinanceFinancingDialogProps {
  sale: Sale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama al terminar, para que la pantalla recargue su bitácora. */
  onRefinanced?: () => void;
}

const MAX_INSTALLMENTS = 60;

// Refinanciar es renegociar, no corregir: lo pagado se queda, lo que se debe
// pasa a un plan nuevo que arranca hoy, con otra tasa, otras cuotas u otra
// frecuencia. La cotización (cuánto es capital, cuánto interés por vencer y
// cuánta mora) la da la base; aquí se elige qué hacer con cada parte y se ve
// la cuota que resultaría.
export function RefinanceFinancingDialog({ sale, open, onOpenChange, onRefinanced }: RefinanceFinancingDialogProps) {
  const { refinanceFinancing } = useSales();
  const { reload: reloadCustomers } = useCustomers();
  const { toast } = useToast();

  const [quote, setQuote] = useState<RefinanceQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState<RefinanceBaseMode>('capital');
  const [lateFee, setLateFee] = useState<RefinanceLateFeeAction | null>(null);
  const [rate, setRate] = useState('');
  const [installments, setInstallments] = useState('');
  const [frequency, setFrequency] = useState<PaymentFrequency>('monthly');
  const [interestMode, setInterestMode] = useState<InterestMode>('monthly_prorated');
  const [firstDue, setFirstDue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Cada vez que se abre, la cotización de hoy y los términos del plan vigente.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setQuote(null);
    setLoadError(null);
    setBase('capital');
    setLateFee(null);
    setFirstDue('');
    setReason('');
    fetchRefinanceQuote('financing', sale.id)
      .then((q) => {
        if (!alive) return;
        setQuote(q);
        setRate(String(q.terms.interestRate));
        setInstallments(String(q.terms.installments));
        setFrequency(q.terms.frequency);
        setInterestMode(q.terms.interestMode);
      })
      .catch((e: any) => alive && setLoadError(e?.message ?? 'No se pudo calcular lo que se debe.'));
    return () => { alive = false; };
  }, [open, sale.id]);

  const n = Number(installments) || 0;
  const numericRate = Number(rate);
  const isRateInvalid = rate === '' || Number.isNaN(numericRate) || numericRate < 0 || numericRate > 100;
  const isInstallmentsInvalid = installments === '' || !Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS;
  // La primera cuota, si se elige, tiene que caer después de hoy (hoy de la empresa).
  const minFirstDue = quote ? toYmd(addDays(parseYmd(quote.today), 1)) : '';
  const isFirstDueInvalid = !!firstDue && !!minFirstDue && firstDue < minFirstDue;

  const amounts = quote ? refinanceBase(quote, base, lateFee) : null;
  const plan = amounts && !isRateInvalid && !isInstallmentsInvalid
    ? previewRefinancePlan(amounts.principal, numericRate, n, frequency, interestMode)
    : null;

  const openInstallments = (sale.installments ?? []).filter((c) => c.status !== 'paid');
  const needsLateFee = !!quote && quote.lateFeeDue > 0 && !lateFee;
  const canSave =
    !!quote && !!plan && !!amounts && amounts.principal > 0 && !needsLateFee &&
    !isFirstDueInvalid && !!reason.trim() && !saving;

  const handleSave = async () => {
    if (!quote || !canSave) return;
    setSaving(true);
    try {
      const result = await refinanceFinancing({
        saleId: sale.id,
        baseMode: base,
        lateFeeAction: quote.lateFeeDue > 0 ? lateFee : null,
        interestRate: numericRate,
        installments: n,
        frequency,
        interestMode,
        firstDueDate: firstDue || undefined,
        reason: reason.trim(),
      });
      await reloadCustomers();
      toast({
        title: 'Financiamiento refinanciado',
        description: `Nueva cuota: ${formatCurrency(result.installmentAmount)}.`,
      });
      onOpenChange(false);
      onRefinanced?.();
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
          <DialogTitle>Refinanciar financiamiento</DialogTitle>
          <DialogDescription>
            Venta del {new Date(sale.createdAt).toLocaleDateString('es-DO')} ·{' '}
            {sale.customer?.name ?? 'Consumidor Final'}
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
              Lo pagado se queda. Las cuotas pendientes se reemplazan por un plan nuevo que arranca hoy,
              con la mora vigente de la sucursal ({quote.newLateFee.rate}%). Los abonos de antes de
              refinanciar ya no se podrán anular.
            </div>

            <RefinanceQuoteSummary quote={quote} />
            <RefinanceOptions
              quote={quote}
              base={base}
              onBaseChange={setBase}
              lateFee={lateFee}
              onLateFeeChange={setLateFee}
            />

            <Separator />

            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="refi-rate">{rateLabel(interestMode)}</Label>
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
                  {isRateInvalid && <p className="text-xs text-destructive">La tasa debe ir de 0 a 100.</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="refi-installments">Cantidad de Cuotas</Label>
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
                  {isInstallmentsInvalid && (
                    <p className="text-xs text-destructive">Entre 1 y {MAX_INSTALLMENTS} cuotas.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="refi-frequency">Frecuencia de Pago</Label>
                  <Select value={frequency} onValueChange={(v: PaymentFrequency) => setFrequency(v)}>
                    <SelectTrigger id="refi-frequency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">{FREQUENCY_LABEL.weekly}</SelectItem>
                      <SelectItem value="biweekly">{FREQUENCY_LABEL.biweekly}</SelectItem>
                      <SelectItem value="monthly">{FREQUENCY_LABEL.monthly}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="refi-mode">Cómo se cobra el interés</Label>
                  <Select value={interestMode} onValueChange={(v: InterestMode) => setInterestMode(v)}>
                    <SelectTrigger id="refi-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly_prorated">{INTEREST_MODE_LABEL.monthly_prorated}</SelectItem>
                      <SelectItem value="per_installment">{INTEREST_MODE_LABEL.per_installment}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

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
                  placeholder="Ej: el cliente perdió el empleo y pidió más plazo"
                />
              </div>
            </div>

            <Separator />

            <RefinanceComparison
              before={{
                installment: sale.financingDetails?.installmentAmount ?? 0,
                installmentsLeft: openInstallments.length,
                balance: quote.pendingBalance,
              }}
              after={plan && amounts ? { principal: amounts.principal, ...plan, n } : null}
              cancelledInterest={base === 'capital' ? quote.unearnedInterest : 0}
            />
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
