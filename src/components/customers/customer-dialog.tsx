'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Customer } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useState } from 'react';
import { useCustomers } from '@/context/customer-provider';

interface CustomerDialogProps {
  customer?: Customer;
  children: React.ReactNode;
}

export function CustomerDialog({ customer, children }: CustomerDialogProps) {
  const { toast } = useToast();
  const { addCustomer, updateCustomer } = useCustomers();
  const isEditMode = !!customer;
  const [open, setOpen] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const newCustomerData = {
      id: customer?.id ?? '',
      name: formData.get('name') as string,
      phone: formData.get('phone') as string,
      email: formData.get('email') as string,
      rnc: formData.get('rnc') as string,
      address: formData.get('address') as string,
      ncfType: (formData.get('ncfType') ?? 'consumer') as 'consumer' | 'fiscal',
      birthdate: formData.get('birthdate') as string,
      notes: formData.get('notes') as string,
      creditBalance: customer?.creditBalance ?? 0, // Preserve existing balance
    }

    if (isEditMode) {
      updateCustomer(newCustomerData);
      toast({
        title: 'Cliente actualizado',
        description: `La información de '${newCustomerData.name}' ha sido actualizada.`,
      });
    } else {
      addCustomer(newCustomerData);
      toast({
        title: 'Cliente añadido',
        description: `El cliente '${newCustomerData.name}' ha sido añadido.`,
      });
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Cliente' : 'Añadir Cliente'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles del cliente.' : 'Añade un nuevo cliente.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input id="name" name="name" defaultValue={customer?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">
                Teléfono
              </Label>
              <Input id="phone" name="phone" defaultValue={customer?.phone} className="col-span-3" required/>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input id="email" name="email" type="email" defaultValue={customer?.email} className="col-span-3" />
            </div>
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rnc" className="text-right">
                RNC / Cédula
              </Label>
              <Input id="rnc" name="rnc" defaultValue={customer?.rnc} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="address" className="text-right">
                Dirección
              </Label>
              <Input id="address" name="address" defaultValue={customer?.address} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="ncfType" className="text-right">
                    Tipo NCF
                </Label>
                <Select name="ncfType" defaultValue={customer?.ncfType ?? 'consumer'} required>
                    <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Selecciona un tipo" />
                    </SelectTrigger>
                    <SelectContent>
                    <SelectItem value="consumer">Consumidor Final</SelectItem>
                    <SelectItem value="fiscal">Crédito Fiscal</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="birthdate" className="text-right">
                Cumpleaños
              </Label>
              <Input id="birthdate" name="birthdate" type="date" defaultValue={customer?.birthdate} className="col-span-3" />
            </div>
             <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="notes" className="text-right pt-2">
                Notas
              </Label>
              <Textarea id="notes" name="notes" placeholder="Preferencias, historial, etc." defaultValue={customer?.notes} className="col-span-3" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">Guardar Cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
