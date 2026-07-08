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
import type { Supplier } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { useSuppliers } from '@/context/supplier-provider';

interface SupplierDialogProps {
  supplier?: Supplier;
  children: React.ReactNode;
}

export function SupplierDialog({ supplier, children }: SupplierDialogProps) {
  const { toast } = useToast();
  const { addSupplier, updateSupplier } = useSuppliers();
  const isEditMode = !!supplier;
  const [open, setOpen] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const name = (formData.get('name') as string)?.trim();
    
    if (!name) {
      toast({
        title: 'Campo requerido',
        description: 'El nombre del proveedor es obligatorio.',
        variant: 'destructive',
      });
      return;
    }

    const newSupplierData = {
      id: supplier?.id ?? '',
      name,
      rnc: formData.get('rnc') as string,
      contactPerson: formData.get('contactPerson') as string,
      phone: formData.get('phone') as string,
      email: formData.get('email') as string,
      address: formData.get('address') as string,
    };

    try {
      if (isEditMode) {
        await updateSupplier(newSupplierData);
        toast({
          title: 'Proveedor actualizado',
          description: `El proveedor '${newSupplierData.name}' ha sido actualizado.`,
        });
      } else {
        await addSupplier(newSupplierData);
        toast({
          title: 'Proveedor añadido',
          description: `El proveedor '${newSupplierData.name}' ha sido registrado.`,
        });
      }
      setOpen(false);
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al guardar',
        description: error?.message || 'No se pudo guardar la información del proveedor.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Proveedor' : 'Añadir Proveedor'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles del proveedor.' : 'Añade un nuevo proveedor.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input id="name" name="name" defaultValue={supplier?.name} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rnc" className="text-right">
                RNC / Cédula
              </Label>
              <Input id="rnc" name="rnc" defaultValue={supplier?.rnc} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="contactPerson" className="text-right">
                Contacto
              </Label>
              <Input id="contactPerson" name="contactPerson" defaultValue={supplier?.contactPerson} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">
                Teléfono
              </Label>
              <Input id="phone" name="phone" defaultValue={supplier?.phone} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input id="email" name="email" type="email" defaultValue={supplier?.email} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="address" className="text-right">
                Dirección
              </Label>
              <Input id="address" name="address" defaultValue={supplier?.address} className="col-span-3" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

