'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Sale } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { useSales } from '@/context/sales-provider';
import { Info } from 'lucide-react';

interface AddFinancingPaymentDialogProps {
  sale: Sale;
  children: React.ReactNode;
}

export function AddFinancingPaymentDialog({ sale, children }: AddFinancingPaymentDialogProps) {
  const { toast } = useToast();
  const { updateSale, addCreditPayment } = useSales();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [userBranch, setUserBranch] = useState('Desconocida');

  const status = useMemo(() => calculateFinancingStatus(sale), [sale]);

  useEffect(() => {
    if (open) {
        setAmount(status.paymentDue);
        const branch = localStorage.getItem('userBranch') || 'Desconocida';
        setUserBranch(branch);
    }
  }, [open, status.paymentDue]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paymentAmount = Number(amount);

    if (paymentAmount <= 0) {
        toast({
            title: 'Monto inválido',
            description: 'El monto del abono no puede ser cero o negativo.',
            variant: 'destructive'
        });
        return;
    }

    const payment = {
        saleId: sale.id,
        customerId: sale.customerId!,
        amount: paymentAmount,
        date: new Date(),
        branchId: userBranch,
    };

    try {
      await addCreditPayment(payment);

      const updatedSale = {
          ...sale,
          amountPaid: sale.amountPaid + paymentAmount,
          payments: [...(sale.payments || []), { ...payment, id: '' }]
      };

      await updateSale(updatedSale);

      toast({
          title: `Abono registrado`,
          description: `Se registró un abono de ${formatCurrency(paymentAmount)} para ${sale.customer?.name}.`,
      });

      setOpen(false);
    } catch (e: any) {
      toast({
          title: 'No se pudo registrar el abono',
          description: e?.message ?? 'Error de conexión con el servidor.',
          variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
        {children}
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
            <DialogTitle>Registrar Abono a Financiamiento</DialogTitle>
            <DialogDescription>
                Cliente: <span className="font-semibold">{sale.customer?.name}</span><br />
                Balance Total: <span className="font-semibold text-destructive">{formatCurrency(status.pendingBalance)}</span>
            </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
                <div className="space-y-4 py-4">
                    {status.isOverdue && (
                        <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-destructive">
                            <Info className="h-5 w-5 mt-0.5 shrink-0"/>
                            <div>
                                <p className="font-semibold">Este financiamiento está atrasado.</p>
                                <p className="text-sm">Mora por atraso: {formatCurrency(status.lateFee)}</p>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">
                        Monto a Pagar
                        </Label>
                        <Input 
                            id="amount" 
                            name="amount" 
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value))}
                            className="col-span-3" 
                            required 
                            placeholder={formatCurrency(status.paymentDue)}
                            />
                    </div>
                     <p className="text-xs text-muted-foreground text-center">
                        El monto sugerido es de <span className="font-semibold">{formatCurrency(status.installmentAmount)} (cuota)</span> + <span className="font-semibold">{formatCurrency(status.lateFee)} (mora)</span>.
                     </p>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancelar</Button>
                    </DialogClose>
                    <Button type="submit" disabled={!amount || Number(amount) <= 0}>Guardar Abono</Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
  );
}
