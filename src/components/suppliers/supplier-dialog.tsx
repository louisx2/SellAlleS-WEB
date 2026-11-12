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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Supplier } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useRef, useState } from 'react';
import { useSuppliers } from '@/context/supplier-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { RncConDgii } from '@/components/dgii/rnc-con-dgii';
import { cascadaNombre, type DatosRnc } from '@/lib/rnc';
import { leerDiasDeCredito, nombreComercialDeDgii } from '@/lib/proveedores';
import { EXPENSE_TYPES_606 } from '@/lib/dgii-606';
import { BANCOS_RD, TIPO_DE_CUENTA } from '@/lib/payment-reports';

// Valor de los selectores para "nada elegido" (Radix no acepta '').
const NINGUNO = 'ninguno';

interface SupplierDialogProps {
  supplier?: Supplier;
  children: React.ReactNode;
}

// El RNC va primero: la DGII trae la razón social y el nombre comercial, y se
// llenan solos. Lo demás (teléfono, correo, dirección, banco) no es público y se
// escribe a mano. Las condiciones (días de crédito, tipo de gasto del 606) son las
// que trae una factura nueva de este proveedor en Cuentas por Pagar.
export function SupplierDialog({ supplier, children }: SupplierDialogProps) {
  const { toast } = useToast();
  const { addSupplier, updateSupplier } = useSuppliers();
  const { profile } = useCompanyProfile();
  const isEditMode = !!supplier;
  const [open, setOpen] = useState(false);
  const [rnc, setRnc] = useState(supplier?.rnc ?? '');
  const [nombre, setNombre] = useState(supplier?.name ?? '');
  const [nombreComercial, setNombreComercial] = useState(supplier?.tradeName ?? '');
  const [ofrecerNombre, setOfrecerNombre] = useState<string | undefined>();
  const [tipoDeGasto, setTipoDeGasto] = useState(supplier?.expenseType606 || NINGUNO);
  const [tipoDeCuenta, setTipoDeCuenta] = useState<string>(supplier?.bankAccountType ?? NINGUNO);
  // Lo último que puso la DGII en cada campo: al corregir un RNC mal escrito no
  // puede quedar el nombre de otra empresa (ver cascadaNombre).
  const nombreAutomatico = useRef<string | undefined>(undefined);
  const comercialAutomatico = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setRnc(supplier?.rnc ?? '');
    setNombre(supplier?.name ?? '');
    setNombreComercial(supplier?.tradeName ?? '');
    setOfrecerNombre(undefined);
    setTipoDeGasto(supplier?.expenseType606 || NINGUNO);
    setTipoDeCuenta(supplier?.bankAccountType ?? NINGUNO);
    nombreAutomatico.current = undefined;
    comercialAutomatico.current = undefined;
  }, [open, supplier]);

  const alEncontrarRnc = (datos: DatosRnc) => {
    const c = cascadaNombre(datos.razonSocial, nombre, nombreAutomatico.current);
    if (c.nombre) {
      setNombre(c.nombre);
      nombreAutomatico.current = c.nombre;
    }
    setOfrecerNombre(c.ofrecerNombre);

    const comercial = nombreComercialDeDgii(datos.nombreComercial, nombreComercial, comercialAutomatico.current);
    if (comercial !== undefined) {
      setNombreComercial(comercial);
      comercialAutomatico.current = comercial || undefined;
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const texto = (campo: string) => ((formData.get(campo) as string | null) ?? '').trim();

    const name = nombre.trim();
    if (!name) {
      toast({
        title: 'Campo requerido',
        description: 'El nombre del proveedor es obligatorio.',
        variant: 'destructive',
      });
      return;
    }

    const dias = leerDiasDeCredito(texto('creditDays'));
    if (!dias.ok) {
      toast({
        title: 'Días de crédito',
        description: 'Escribe un número entero de 0 a 365, o déjalo vacío si no hay plazo.',
        variant: 'destructive',
      });
      return;
    }

    const newSupplierData: Supplier = {
      id: supplier?.id ?? '',
      name,
      rnc: rnc.trim(),
      tradeName: nombreComercial.trim(),
      contactPerson: texto('contactPerson'),
      phone: texto('phone'),
      email: texto('email'),
      address: texto('address'),
      creditDays: dias.dias,
      expenseType606: tipoDeGasto === NINGUNO ? '' : tipoDeGasto,
      bankName: texto('bankName'),
      bankAccountType: tipoDeCuenta === 'ahorro' || tipoDeCuenta === 'corriente' ? tipoDeCuenta : null,
      bankAccountNumber: texto('bankAccountNumber'),
      notes: texto('notes'),
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
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Proveedor' : 'Añadir Proveedor'}</DialogTitle>
          <DialogDescription>
            Escribe el RNC primero: la DGII trae el nombre y el nombre comercial.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-5 py-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rnc">RNC / Cédula</Label>
                <RncConDgii
                  id="rnc"
                  value={rnc}
                  onChange={(v) => {
                    setRnc(v);
                    setOfrecerNombre(undefined);
                  }}
                  onDatos={alEncontrarRnc}
                  libre
                  autoFocus={!isEditMode}
                  ofrecerNombre={ofrecerNombre}
                  onUsarNombre={(n) => {
                    setNombre(n);
                    nombreAutomatico.current = n;
                    setOfrecerNombre(undefined);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Nombre o razón social *</Label>
                <Input id="name" name="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tradeName">Nombre comercial</Label>
                <Input
                  id="tradeName"
                  value={nombreComercial}
                  onChange={(e) => setNombreComercial(e.target.value)}
                  placeholder="Como se conoce el negocio"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contactPerson">Contacto</Label>
                  <Input id="contactPerson" name="contactPerson" defaultValue={supplier?.contactPerson} placeholder="Vendedor o encargado" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input id="phone" name="phone" type="tel" defaultValue={supplier?.phone} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={supplier?.email} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">Dirección</Label>
                <Input id="address" name="address" defaultValue={supplier?.address} />
              </div>
            </div>

            <fieldset className="space-y-3 border-t pt-4">
              <legend className="pr-2 text-sm font-medium">Condiciones</legend>
              <p className="text-xs text-muted-foreground">
                Lo que trae una factura nueva de este proveedor en Cuentas por Pagar. Se puede cambiar en cada factura.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="creditDays">Días de crédito</Label>
                  <Input
                    id="creditDays"
                    name="creditDays"
                    inputMode="numeric"
                    defaultValue={supplier?.creditDays ?? ''}
                    placeholder="Ej.: 30"
                  />
                  <p className="text-xs text-muted-foreground">0 = contado. Vacío = sin plazo fijo.</p>
                </div>
                {profile.isFormalized && (
                  <div className="space-y-1.5">
                    <Label htmlFor="expenseType606">Tipo de gasto (606)</Label>
                    <Select value={tipoDeGasto} onValueChange={setTipoDeGasto}>
                      <SelectTrigger id="expenseType606"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NINGUNO}>Sin tipo fijo (09 en la factura)</SelectItem>
                        {EXPENSE_TYPES_606.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </fieldset>

            <fieldset className="space-y-3 border-t pt-4">
              <legend className="pr-2 text-sm font-medium">Para pagarle</legend>
              <div className="space-y-1.5">
                <Label htmlFor="bankName">Banco</Label>
                <Input id="bankName" name="bankName" list="bancos-proveedor" defaultValue={supplier?.bankName} placeholder="Banreservas" />
                <datalist id="bancos-proveedor">{BANCOS_RD.map((b) => <option key={b} value={b} />)}</datalist>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bankAccountType">Tipo de cuenta</Label>
                  <Select value={tipoDeCuenta} onValueChange={setTipoDeCuenta}>
                    <SelectTrigger id="bankAccountType"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Sin indicar</SelectItem>
                      <SelectItem value="ahorro">{TIPO_DE_CUENTA.ahorro}</SelectItem>
                      <SelectItem value="corriente">{TIPO_DE_CUENTA.corriente}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bankAccountNumber">Número de cuenta</Label>
                  <Input id="bankAccountNumber" name="bankAccountNumber" inputMode="numeric" defaultValue={supplier?.bankAccountNumber} />
                </div>
              </div>
            </fieldset>

            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                defaultValue={supplier?.notes}
                placeholder="Días de entrega, quién despacha, pedido mínimo…"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
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
