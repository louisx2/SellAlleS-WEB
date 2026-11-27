'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import type { ServiceType, Staff } from '@/lib/types';
import { SELECT_CLASS } from './ficha-picker';
import { PersonasCasillas } from './personas-linea-dialog';

/** Agrega a una orden abierta y sin cobrar un servicio del catálogo con quién lo
 *  hace. Sirve también para completar una orden que se creó sin sus servicios.
 *  Se monta al abrirse. */
export function AgregarServicioDialog({ serviceId, catalog, staff, defaultStaffIds, enGarantia, onClose, onSaved }: {
  serviceId: string;
  /** Servicios que se pueden agregar (activos, con artículo y de esta ficha). */
  catalog: ServiceType[];
  /** Personas de la sucursal de la orden, activas e inactivas. */
  staff: Staff[];
  defaultStaffIds: string[];
  /** Reingreso por garantía: entra en RD$0 (el precio se puede cambiar en la línea). */
  enGarantia: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [serviceTypeId, setServiceTypeId] = useState(catalog.length === 1 ? catalog[0].id : '');
  const [staffIds, setStaffIds] = useState<string[]>(
    defaultStaffIds.filter((id) => staff.some((p) => p.id === id && p.isActive)),
  );
  const [busy, setBusy] = useState(false);
  const st = catalog.find((s) => s.id === serviceTypeId);

  const save = async () => {
    if (!st?.productId) return;
    setBusy(true);
    // El id sale de aquí para poner a las personas en esta línea.
    const id = crypto.randomUUID();
    const { error } = await supabase.from('service_items').insert({
      id, service_id: serviceId, product_id: st.productId, quantity: 1,
      price: enGarantia ? 0 : st.price, kind: 'labor', service_type_id: st.id,
    });
    if (error) {
      setBusy(false);
      toast({ title: 'No se pudo agregar el servicio', description: error.message, variant: 'destructive' });
      return;
    }
    if (staffIds.length) {
      const { error: staffError } = await supabase.from('service_item_staff')
        .insert(staffIds.map((staffId) => ({ service_item_id: id, staff_id: staffId })));
      if (staffError) {
        setBusy(false);
        toast({
          title: 'El servicio se agregó, pero no quién lo hace',
          description: `${staffError.message} Ponlo con el botón de personas de la línea.`,
          variant: 'destructive',
        });
        onSaved();
        return;
      }
    }
    setBusy(false);
    toast({ title: 'Servicio agregado' });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar servicio</DialogTitle>
          <DialogDescription>
            {enGarantia ? 'Entra en RD$0 por ser garantía; el precio se puede cambiar en la línea.' : 'Con el precio del catálogo; se puede cambiar en la línea.'}
          </DialogDescription>
        </DialogHeader>
        {catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay servicios en el catálogo para esta orden. <Link href="/service-types" className="underline">Agrégalos</Link>.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="agregar-servicio">Servicio</Label>
              <select id="agregar-servicio" className={SELECT_CLASS} value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
                <option value="">Elige un servicio</option>
                {catalog.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {formatCurrency(enGarantia ? 0 : s.price)}</option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Lo hace</legend>
              <PersonasCasillas staff={staff} value={staffIds} onChange={setStaffIds} />
            </fieldset>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !st}>{busy ? 'Guardando…' : 'Agregar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
