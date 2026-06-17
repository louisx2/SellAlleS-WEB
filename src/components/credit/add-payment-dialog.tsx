'use client';

import { useState, useEffect } from 'react';
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
import type { Customer } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCustomers } from '@/context/customer-provider';
import { addCreditPayment } from '@/lib/database';
import { formatCurrency } from '@/lib/utils';

interface AddPaymentDialogProps {
  customer: Customer;
  children: React.ReactNode;
}

export function AddPaymentDialog({ customer, children }: AddPaymentDialogProps) {
  const { toast } = useToast();
  const { updateCustomer } = useCustomers();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [userBranch, setUserBranch] = useState('Desconocida');

  useEffect(() => {
    if (open) {
        setAmount('');
        const branch = localStorage.getItem('userBranch') || 'Desconocida';
        setUserBranch(branch);
    }
  }, [open])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paymentAmount = Number(amount);

    if (paymentAmount <= 0 || paymentAmount > customer.creditBalance) {
        toast({
            title: 'Monto inválido',
            description: 'El monto del abono no puede ser cero, negativo o mayor que la deuda.',
            variant: 'destructive'
        });
        return;
    }

    addCreditPayment({
        id: `PAY-${Date.now()}`,
        saleId: 'N/A', // Not linked to a specific sale in this simplified version
        customerId: customer.id,
        amount: paymentAmount,
        date: new Date(),
        branchId: userBranch,
    });
    
    // This is a direct mutation for the mock data, in a real app this would be a server action
    updateCustomer({ ...customer, creditBalance: customer.creditBalance - paymentAmount });

    toast({
        title: `Abono registrado`,
        description: `Se registró un abono de ${formatCurrency(paymentAmount)} para ${customer.name}.`,
    });
    
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Abono a Deuda</DialogTitle>
          <DialogDescription>
            Cliente: <span className="font-semibold">{customer.name}</span><br />
            Deuda Actual: <span className="font-semibold text-destructive">{formatCurrency(customer.creditBalance)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="amount" className="text-right">
                Monto
              </Label>
              <Input 
                id="amount" 
                name="amount" 
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="col-span-3" 
                required 
                placeholder={formatCurrency(customer.creditBalance)}
                />
            </div>
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
