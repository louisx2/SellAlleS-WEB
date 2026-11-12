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
import { useEffect, useRef, useState } from 'react';
import { useSuppliers } from '@/context/supplier-provider';
import { RncConDgii } from '@/components/dgii/rnc-con-dgii';
import { cascadaNombre, type DatosRnc } from '@/lib/rnc';

interface SupplierDialogProps {
  supplier?: Supplier;
  children: React.ReactNode;
}

export function SupplierDialog({ supplier, children }: SupplierDialogProps) {
  const { toast } = useToast();
  const { addSupplier, updateSupplier } = useSuppliers();
  const isEditMode = !!supplier;
  const [open, setOpen] = useState(false);
  // El nombre se llena con la razón social que trae la DGII al escribir el RNC.
  const [nombre, setNombre] = useState(supplier?.name ?? '');
  const [rnc, setRnc] = useState(supplier?.rnc ?? '');
  const [ofrecerNombre, setOfrecerNombre] = useState<string | undefined>();
  // El último nombre que puso la DGII (ver cascadaNombre).
  const nombreAutomatico = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setNombre(supplier?.name ?? '');
    setRnc(supplier?.rnc ?? '');
    setOfrecerNombre(undefined);
    nombreAutomatico.current = undefined;
  }, [open, supplier]);

  const alEncontrarRnc = (datos: DatosRnc) => {
    const c = cascadaNombre(datos.razonSocial, nombre, nombreAutomatico.current);
    if (c.nombre) {
      setNombre(c.nombre);
      nombreAutomatico.current = c.nombre;
    }
    setOfrecerNombre(c.ofrecerNombre);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const name = nombre.trim();

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
      rnc: rnc.trim(),
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
              <Input id="name" name="name" value={nombre} onChange={(e) => setNombre(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="rnc" className="text-right pt-2.5">
                RNC / Cédula
              </Label>
              <RncConDgii
                id="rnc"
                value={rnc}
                onChange={(v) => {
                  setRnc(v);
                  setOfrecerNombre(undefined);
                }}
                onDatos={alEncontrarRnc}
                libre
                ofrecerNombre={ofrecerNombre}
                onUsarNombre={(n) => {
                  setNombre(n);
                  nombreAutomatico.current = n;
                  setOfrecerNombre(undefined);
                }}
                className="col-span-3"
              />
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

