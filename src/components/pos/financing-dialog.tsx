'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency } from '@/lib/utils';
import { useCaja } from '@/context/caja-provider';
import { useFinancingSettings } from '@/hooks/use-financing-settings';
import {
  FREQUENCY_LABEL,
  INTEREST_MODE_LABEL,
  addPeriods,
  installmentLabel,
  monthsFor,
  rateLabel,
  type InterestMode,
  type PaymentFrequency,
} from '@/lib/frequency';
import type { FinancingDetails } from '@/lib/types';
import { Separator } from '../ui/separator';

interface FinancingDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  totalAmount: number;
  /** Crédito disponible del cliente (null = sin límite). */
  availableCredit?: number | null;
  onFinancingComplete: (details: {
    downPayment: number;
    financingDetails: FinancingDetails;
    downPaymentMethod?: 'cash' | 'card' | 'transfer';
    downPaymentReference?: string;
  }) => void;
}

// Mismo tope que valida la base. Antes era un desplegable de 3/6/9/12/18/24,
// que con frecuencia quincenal se queda corto: 26 quincenas son un año.
const MAX_INSTALLMENTS = 60;

export function FinancingDialog({ isOpen, onOpenChange, totalAmount, availableCredit, onFinancingComplete }: FinancingDialogProps) {
  const { cashBlocked } = useCaja();
  // Los valores con los que abre el diálogo salen de la sucursal activa, y de
  // la empresa para lo que la sucursal no tenga propio.
  const settings = useFinancingSettings();
  const [downPayment, setDownPayment] = useState<number | string>('');
  const [interestRate, setInterestRate] = useState<number | string>(settings.interestRate);
  const [installments, setInstallments] = useState<string>(String(settings.installments));
  const [frequency, setFrequency] = useState<PaymentFrequency>(settings.frequency);
  const [interestMode, setInterestMode] = useState<InterestMode>(settings.interestMode);
  const [downPaymentMethod, setDownPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [downPaymentReference, setDownPaymentReference] = useState('');

  useEffect(() => {
    if (isOpen) {
        setDownPayment('');
        setInterestRate(settings.interestRate);
        setInstallments(String(settings.installments));
        setFrequency(settings.frequency);
        setInterestMode(settings.interestMode);
        setDownPaymentMethod(cashBlocked ? 'card' : 'cash');
        setDownPaymentReference('');
    }
  }, [isOpen, settings.interestRate, settings.installments, settings.frequency, settings.interestMode, cashBlocked]);

  const nInstallments = Number(installments) || 0;
  const isInstallmentsInvalid =
    installments === '' || !Number.isInteger(nInstallments) || nInstallments < 1 || nInstallments > MAX_INSTALLMENTS;

  const { amountToFinance, installmentAmount, totalWithInterest, totalFinanced, months } = useMemo(() => {
    const dp = Number(downPayment) || 0;
    const rate = Number(interestRate) || 0;
    const principal = totalAmount - dp;

    if (principal <= 0 || nInstallments <= 0 || nInstallments > MAX_INSTALLMENTS) {
      return { amountToFinance: principal, installmentAmount: 0, totalWithInterest: totalAmount, totalFinanced: 0, months: 0 };
    }

    // Interés SIMPLE. Cuántos "meses" cobra el plan depende del modo: la tasa
    // mensual se prorratea a la duración real (12 quincenas = 6 meses), o cada
    // cuota cobra la tasa. Mismo cálculo que `before_sale_credit_checks`: la
    // base recalcula estos montos al guardar y esto es solo la vista previa.
    const m = monthsFor(frequency, nInstallments, interestMode);
    const simpleInterest = principal * (rate / 100) * m;
    const financed = principal + simpleInterest;

    return {
      amountToFinance: principal,
      installmentAmount: financed / nInstallments,
      totalWithInterest: financed + dp,
      totalFinanced: financed,
      months: m,
    };
  }, [totalAmount, downPayment, interestRate, nInstallments, frequency, interestMode]);

  // Cronograma estimado; las fechas definitivas las calcula el servidor desde
  // el día de la venta en hora del país.
  const schedule = useMemo(() => {
    if (installmentAmount <= 0) return [];
    return Array.from({ length: nInstallments }, (_, i) => ({
      number: i + 1,
      dueDate: addPeriods(new Date(), frequency, i + 1),
      amount: installmentAmount,
    }));
  }, [nInstallments, installmentAmount, frequency]);

  const handleAmountChange = (setter: React.Dispatch<React.SetStateAction<string | number>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const decimalRegex = /^\d*(\.\d{0,2})?$/;
    if (decimalRegex.test(value) && value.length <= 9) {
      setter(value);
    }
  };

  const handleConfirm = () => {
    const financingDetails: FinancingDetails = {
      interestRate: Number(interestRate) || 0,
      interestMode,
      frequency,
      installments: nInstallments,
      installmentAmount: installmentAmount,
      totalWithInterest: totalWithInterest,
      downPayment: Number(downPayment) || 0,
    };

    onFinancingComplete({
      downPayment: Number(downPayment) || 0,
      financingDetails,
      downPaymentMethod,
      downPaymentReference: downPaymentReference.trim() || undefined,
    });
  };

  const hasDownPayment = Number(downPayment) > 0;
  const isDownPaymentInvalid = Number(downPayment) < 0 || Number(downPayment) >= totalAmount;
  const isRateInvalid = interestRate === '' || Number(interestRate) < 0 || Number(interestRate) > 100;
  const isOverCreditLimit = availableCredit != null && totalFinanced > availableCredit;
  const isDownPaymentCashBlocked = hasDownPayment && downPaymentMethod === 'cash' && cashBlocked;
  const isDownPaymentRefInvalid = hasDownPayment && downPaymentMethod === 'transfer' && !downPaymentReference.trim();

  // "…(6 meses de interés)" hace visible el efecto del modo, que es justo lo
  // que se presta a confusión cuando el cliente pregunta por qué paga eso.
  const monthsLabel = months > 0
    ? `${Number.isInteger(months) ? months : months.toFixed(1)} ${months === 1 ? 'mes' : 'meses'} de interés`
    : '';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[95vh] overflow-y-auto [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Configurar Financiamiento</DialogTitle>
          <DialogDescription>
            Términos para la venta a cuotas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="downPayment">Abono Inicial (Opcional)</Label>
                    <Input
                        id="downPayment"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={downPayment}
                        onChange={handleAmountChange(setDownPayment)}
                        onFocus={(e) => e.target.select()}
                    />
                    {isDownPaymentInvalid && <p className="text-xs text-destructive">El abono no puede ser negativo o mayor al total.</p>}
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="amountToFinance">Monto a Financiar</Label>
                    <Input id="amountToFinance" value={formatCurrency(amountToFinance)} readOnly disabled />
                </div>
            </div>

            {hasDownPayment && (
                <div className="space-y-2">
                    <Label htmlFor="financing-down-method">¿Cómo entró el abono inicial?</Label>
                    <Select value={downPaymentMethod} onValueChange={(v: 'cash' | 'card' | 'transfer') => setDownPaymentMethod(v)}>
                        <SelectTrigger id="financing-down-method"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="cash" disabled={cashBlocked}>Efectivo</SelectItem>
                            <SelectItem value="card">Tarjeta</SelectItem>
                            <SelectItem value="transfer">Transferencia</SelectItem>
                        </SelectContent>
                    </Select>
                    {(downPaymentMethod === 'transfer' || downPaymentMethod === 'card') && (
                        <Input
                            placeholder={downPaymentMethod === 'transfer' ? 'No. de transferencia / referencia' : 'No. de aprobación / referencia'}
                            value={downPaymentReference}
                            onChange={(e) => setDownPaymentReference(e.target.value)}
                        />
                    )}
                    {isDownPaymentCashBlocked && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">No hay caja abierta: no puedes recibir el abono inicial en efectivo.</p>
                    )}
                    {isDownPaymentRefInvalid && (
                        <p className="text-xs text-destructive">Indica la referencia de la transferencia.</p>
                    )}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="financing-frequency">Frecuencia de Pago</Label>
                    <Select value={frequency} onValueChange={(v: PaymentFrequency) => setFrequency(v)}>
                        <SelectTrigger id="financing-frequency"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="weekly">{FREQUENCY_LABEL.weekly}</SelectItem>
                            <SelectItem value="biweekly">{FREQUENCY_LABEL.biweekly}</SelectItem>
                            <SelectItem value="monthly">{FREQUENCY_LABEL.monthly}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="installments">Cantidad de Cuotas</Label>
                    <Input
                        id="installments"
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
                    <Label htmlFor="interestRate">{rateLabel(interestMode)}</Label>
                    <Input
                        id="interestRate"
                        type="text"
                        inputMode="decimal"
                        value={interestRate}
                        onChange={handleAmountChange(setInterestRate)}
                        onFocus={(e) => e.target.select()}
                    />
                    {isRateInvalid && <p className="text-xs text-destructive">La tasa debe ir de 0 a 100.</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="interest-mode">Cómo se cobra el interés</Label>
                    <Select value={interestMode} onValueChange={(v: InterestMode) => setInterestMode(v)}>
                        <SelectTrigger id="interest-mode"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="monthly_prorated">{INTEREST_MODE_LABEL.monthly_prorated}</SelectItem>
                            <SelectItem value="per_installment">{INTEREST_MODE_LABEL.per_installment}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>

        <Separator />

        <div className="space-y-2 text-sm">
            <h4 className="font-semibold text-center mb-4">Resumen del Plan de Pagos</h4>
            <div className="flex justify-between items-center text-lg font-bold bg-secondary p-3 rounded-md">
                <span className="text-primary">{installmentLabel(frequency)}:</span>
                <span className="text-primary">{formatCurrency(installmentAmount)}</span>
            </div>
            <div className="flex justify-between mt-2">
                <span>Total de la venta:</span>
                <span>{formatCurrency(totalAmount)}</span>
            </div>
             <div className="flex justify-between">
                <span>Intereses a pagar{monthsLabel && ` (${monthsLabel})`}:</span>
                <span>{formatCurrency(totalWithInterest - totalAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold">
                <span>Total a Pagar (con intereses):</span>
                <span>{formatCurrency(totalWithInterest)}</span>
            </div>

            {schedule.length > 0 && (
              <ScrollArea className="h-28 rounded-md border mt-2">
                <div className="p-2 space-y-1">
                  {schedule.map((cuota) => (
                    <div key={cuota.number} className="flex justify-between text-xs text-muted-foreground">
                      <span>Cuota {cuota.number} — {cuota.dueDate.toLocaleDateString('es-DO')}</span>
                      <span>{formatCurrency(cuota.amount)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Los montos y fechas definitivos los calcula el servidor al registrar la venta.
            </p>
            {isOverCreditLimit && (
              <p className="text-xs text-destructive text-center font-medium">
                El monto a financiar ({formatCurrency(totalFinanced)}) excede el crédito disponible
                del cliente ({formatCurrency(availableCredit ?? 0)}).
              </p>
            )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isDownPaymentInvalid || isRateInvalid || isInstallmentsInvalid || isOverCreditLimit || installmentAmount <= 0 || isDownPaymentCashBlocked || isDownPaymentRefInvalid}
          >
            Confirmar Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
