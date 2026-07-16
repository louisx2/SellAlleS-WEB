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
import { useEffect, useState } from 'react';
import { useCustomers } from '@/context/customer-provider';
import { useAuth } from '@/context/auth-provider';
import { formatCedulaOrRnc, formatPhone } from '@/lib/format';

interface CustomerDialogProps {
  customer?: Customer;
  children: React.ReactNode;
  onSuccess?: (customer: Customer) => void;
}

export function CustomerDialog({ customer, children, onSuccess }: CustomerDialogProps) {
  const { toast } = useToast();
  const { addCustomer, updateCustomer } = useCustomers();
  const { appUser } = useAuth();
  const isEditMode = !!customer;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [rnc, setRnc] = useState(customer?.rnc ?? '');

  useEffect(() => {
    if (!open) return;
    setPhone(customer?.phone ?? '');
    setRnc(customer?.rnc ?? '');
  }, [open, customer]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const name = (formData.get('name') as string)?.trim();
    const trimmedPhone = phone.trim();

    if (!name || !trimmedPhone) {
      toast({
        title: 'Campos requeridos vacíos',
        description: 'El Nombre y el Teléfono son obligatorios.',
        variant: 'destructive',
      });
      return;
    }

    const creditLimitRaw = (formData.get('creditLimit') as string)?.trim();
    const discountRaw = (formData.get('discountPercentage') as string)?.trim();
    const discountPercentage = discountRaw ? Number(discountRaw) : 0;

    if (isNaN(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
      toast({
        title: 'Descuento inválido',
        description: 'El descuento debe ser un porcentaje entre 0 y 100.',
        variant: 'destructive',
      });
      return;
    }

    const newCustomerData = {
      id: customer?.id ?? '',
      name: name,
      phone: trimmedPhone,
      email: formData.get('email') as string,
      rnc: rnc.trim(),
      address: formData.get('address') as string,
      ncfType: (formData.get('ncfType') ?? 'consumer') as 'consumer' | 'fiscal',
      birthdate: formData.get('birthdate') as string,
      notes: formData.get('notes') as string,
      creditBalance: customer?.creditBalance ?? 0, // Preserve existing balance
      creditLimit: creditLimitRaw ? Number(creditLimitRaw) : null, // vacío = sin límite
      discountPercentage,
      loyaltyPurchaseCount: customer?.loyaltyPurchaseCount ?? 0, // Preserve existing counter
    }

    setSaving(true);
    try {
      if (isEditMode) {
        await updateCustomer(newCustomerData);
        toast({
          title: 'Cliente actualizado',
          description: `La información de '${newCustomerData.name}' ha sido actualizada.`,
        });
      } else {
        const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
        const created = await addCustomer(newCustomerData, activeCompanyId);
        toast({
          title: 'Cliente añadido',
          description: `El cliente '${newCustomerData.name}' ha sido añadido.`,
        });
        if (onSuccess && created) {
          onSuccess(created);
        }
      }
      setOpen(false);
    } catch (err: any) {
      toast({
        title: 'Error al guardar',
        description: err.message || 'Ocurrió un error inesperado al guardar el cliente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input id="name" name="name" defaultValue={customer?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">
                Teléfono <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phone"
                name="phone"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="809-000-0000"
                className="col-span-3"
                required
              />
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
              <Input
                id="rnc"
                name="rnc"
                value={rnc}
                onChange={(e) => setRnc(formatCedulaOrRnc(e.target.value))}
                placeholder="000-0000000-0"
                className="col-span-3"
              />
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
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="creditLimit" className="text-right">
                Límite de Crédito
              </Label>
              <Input
                id="creditLimit"
                name="creditLimit"
                type="number"
                min="0"
                step="0.01"
                placeholder="Vacío = sin límite"
                defaultValue={customer?.creditLimit ?? ''}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="discountPercentage" className="text-right">
                Descuento (%)
              </Label>
              <Input
                id="discountPercentage"
                name="discountPercentage"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="0 = sin descuento"
                defaultValue={customer?.discountPercentage || ''}
                className="col-span-3"
              />
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
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
