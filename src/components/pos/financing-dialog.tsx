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
import { formatCurrency } from '@/lib/utils';
import type { FinancingDetails } from '@/lib/types';
import { Separator } from '../ui/separator';

interface FinancingDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  totalAmount: number;
  onFinancingComplete: (details: { downPayment: number; financingDetails: FinancingDetails }) => void;
}

const installmentOptions = [3, 6, 9, 12, 18, 24];

export function FinancingDialog({ isOpen, onOpenChange, totalAmount, onFinancingComplete }: FinancingDialogProps) {
  const [downPayment, setDownPayment] = useState<number | string>('');
  const [interestRate, setInterestRate] = useState<number | string>(3.5);
  const [installments, setInstallments] = useState<number>(12);

  useEffect(() => {
    if (isOpen) {
        setDownPayment('');
        setInterestRate(3.5);
        setInstallments(12);
    }
  }, [isOpen])

  const { amountToFinance, installmentAmount, totalWithInterest } = useMemo(() => {
    const dp = Number(downPayment) || 0;
    const rate = Number(interestRate) || 0;
    
    if (rate <= 0 || installments <= 0) {
      return { amountToFinance: totalAmount - dp, installmentAmount: 0, totalWithInterest: totalAmount };
    }

    const principal = totalAmount - dp;
    const monthlyRate = (rate / 100); 
    const simpleInterest = principal * monthlyRate * (installments / 12);
    const totalFinanced = principal + simpleInterest;
    
    return {
      amountToFinance: principal,
      installmentAmount: totalFinanced > 0 && installments > 0 ? totalFinanced / installments : 0,
      totalWithInterest: totalFinanced + dp,
    };
  }, [totalAmount, downPayment, interestRate, installments]);
  
  const handleAmountChange = (setter: React.Dispatch<React.SetStateAction<string | number>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const decimalRegex = /^\d*(\.\d{0,2})?$/;
    if (decimalRegex.test(value) && value.length <= 9) {
      setter(value);
    }
  };

  const handleConfirm = () => {
    const financingDetails: FinancingDetails = {
      interestRate: Number(interestRate),
      installments: installments,
      installmentAmount: installmentAmount,
      totalWithInterest: totalWithInterest,
    };
    
    onFinancingComplete({
      downPayment: Number(downPayment) || 0,
      financingDetails,
    });
  };

  const isDownPaymentInvalid = Number(downPayment) < 0 || Number(downPayment) >= totalAmount;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm} disabled={isDownPaymentInvalid || Number(interestRate) <= 0}>Confirmar Plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
