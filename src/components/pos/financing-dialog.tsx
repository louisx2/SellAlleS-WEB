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
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useModules } from '@/context/modules-provider';
import { useCaja } from '@/context/caja-provider';
import type { FinancingDetails } from '@/lib/types';
import { Separator } from '../ui/separator';
import { addMonths } from 'date-fns';

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

const installmentOptions = [3, 6, 9, 12, 18, 24];

export function FinancingDialog({ isOpen, onOpenChange, totalAmount, availableCredit, onFinancingComplete }: FinancingDialogProps) {
  const { profile } = useCompanyProfile();
  const { isModuleEnabled } = useModules();
  const { isOpen: isCajaOpen } = useCaja();
  const cashBlocked = isModuleEnabled('caja') && !isCajaOpen;
  const [downPayment, setDownPayment] = useState<number | string>('');
  const [interestRate, setInterestRate] = useState<number | string>(profile.defaultInterestRate);
  const [installments, setInstallments] = useState<number>(12);
  const [downPaymentMethod, setDownPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [downPaymentReference, setDownPaymentReference] = useState('');

  useEffect(() => {
    if (isOpen) {
        setDownPayment('');
        setInterestRate(profile.defaultInterestRate);
        setInstallments(12);
        setDownPaymentMethod(cashBlocked ? 'card' : 'cash');
        setDownPaymentReference('');
    }
  }, [isOpen, profile.defaultInterestRate, cashBlocked]);

  const { amountToFinance, installmentAmount, totalWithInterest, totalFinanced } = useMemo(() => {
    const dp = Number(downPayment) || 0;
    const rate = Number(interestRate) || 0;
    const principal = totalAmount - dp;

    if (principal <= 0 || installments <= 0) {
      return { amountToFinance: principal, installmentAmount: 0, totalWithInterest: totalAmount, totalFinanced: 0 };
    }

    // Interés SIMPLE MENSUAL: principal × tasa% × meses.
    // La base recalcula estos montos al guardar (trigger de la venta);
    // esto es solo la vista previa.
    const simpleInterest = principal * (rate / 100) * installments;
    const financed = principal + simpleInterest;

    return {
      amountToFinance: principal,
      installmentAmount: financed / installments,
      totalWithInterest: financed + dp,
      totalFinanced: financed,
    };
  }, [totalAmount, downPayment, interestRate, installments]);

  // Cronograma estimado (fechas definitivas: día de la venta + k meses).
  const schedule = useMemo(() => {
    if (installmentAmount <= 0) return [];
    return Array.from({ length: installments }, (_, i) => ({
      number: i + 1,
      dueDate: addMonths(new Date(), i + 1),
      amount: installmentAmount,
    }));
  }, [installments, installmentAmount]);

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
      installments: installments,
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
  const isRateInvalid = interestRate === '' || Number(interestRate) < 0;
  const isOverCreditLimit = availableCredit != null && totalFinanced > availableCredit;
  const isDownPaymentCashBlocked = hasDownPayment && downPaymentMethod === 'cash' && cashBlocked;
  const isDownPaymentRefInvalid = hasDownPayment && downPaymentMethod === 'transfer' && !downPaymentReference.trim();

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
                    <Label htmlFor="interestRate">Tasa de Interés Mensual (%)</Label>
                    <Input
                        id="interestRate"
                        type="text"
                        inputMode="decimal"
                        value={interestRate}
                        onChange={handleAmountChange(setInterestRate)}
                        onFocus={(e) => e.target.select()}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="installments">Cantidad de Cuotas</Label>
                    <Select value={String(installments)} onValueChange={(val) => setInstallments(Number(val))}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecciona cuotas" />
                        </SelectTrigger>
                        <SelectContent>
                        {installmentOptions.map(opt => (
                            <SelectItem key={opt} value={String(opt)}>{opt} cuotas</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>

        <Separator />

        <div className="space-y-2 text-sm">
            <h4 className="font-semibold text-center mb-4">Resumen del Plan de Pagos</h4>
            <div className="flex justify-between items-center text-lg font-bold bg-secondary p-3 rounded-md">
                <span className="text-primary">Cuota Mensual:</span>
                <span className="text-primary">{formatCurrency(installmentAmount)}</span>
            </div>
            <div className="flex justify-between mt-2">
                <span>Total de la venta:</span>
                <span>{formatCurrency(totalAmount)}</span>
            </div>
             <div className="flex justify-between">
                <span>Intereses a pagar:</span>
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
          <Button type="button" onClick={handleConfirm} disabled={isDownPaymentInvalid || isRateInvalid || isOverCreditLimit || installmentAmount <= 0 || isDownPaymentCashBlocked || isDownPaymentRefInvalid}>Confirmar Plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
