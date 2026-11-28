'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { ServiceItem, Staff } from '@/lib/types';

/** Casillas de «Lo hace». `staff` son las personas de la sucursal; las inactivas
 *  solo salen si ya están marcadas (se pueden quitar, no poner). */
export function PersonasCasillas({ staff, value, onChange }: {
  staff: Staff[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const uid = useId();
  const conocidas = new Set(staff.map((p) => p.id));
  const opciones = [
    ...staff.filter((p) => p.isActive || value.includes(p.id)),
    // Alguien marcado que no es de la lista cargada (otra sucursal).
    ...value.filter((id) => !conocidas.has(id)).map((id) => ({ id, name: 'Otra persona', isActive: false })),
  ];
  if (opciones.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay personal activo en esta sucursal. <Link href="/service-types" className="underline">Agrégalo</Link>.
      </p>
    );
  }
  const toggle = (id: string, on: boolean) => {
    const resto = value.filter((x) => x !== id);
    onChange(on ? [...resto, id] : resto);
  };
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {opciones.map((p) => {
        const id = `${uid}-${p.id}`;
        const marcada = value.includes(p.id);
        return (
          <label key={p.id} htmlFor={id} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={id} checked={marcada}
              disabled={!p.isActive && !marcada}
              onCheckedChange={(v) => toggle(p.id, v === true)}
            />
            {p.name}{!p.isActive && <span className="text-xs text-muted-foreground">(ya no está activa)</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Quién hace una línea de servicio de la orden: escribe en `service_item_staff`.
 *  La base lo permite mientras la orden siga abierta y sin cobrar. Se monta al
 *  abrirse. `onSaved(false)`: cambió una parte (ya se avisó del error). */
export function PersonasLineaDialog({ line, staff, onClose, onSaved }: {
  line: ServiceItem;
  /** Personas de la sucursal de la orden, activas e inactivas. */
  staff: Staff[];
  onClose: () => void;
  onSaved: (ok: boolean) => void;
}) {
  const { toast } = useToast();
  const [ids, setIds] = useState<string[]>(line.staffIds);
  const [busy, setBusy] = useState(false);

  const poner = ids.filter((id) => !line.staffIds.includes(id));
  const quitar = line.staffIds.filter((id) => !ids.includes(id));

  const save = async () => {
    setBusy(true);
    if (poner.length) {
      const { error } = await supabase.from('service_item_staff')
        .insert(poner.map((staffId) => ({ service_item_id: line.id, staff_id: staffId })));
      if (error) {
        setBusy(false);
        toast({ title: 'No se pudo cambiar quién lo hace', description: error.message, variant: 'destructive' });
        return;
      }
    }
    if (quitar.length) {
      const { error } = await supabase.from('service_item_staff')
        .delete().eq('service_item_id', line.id).in('staff_id', quitar);
      if (error) {
        setBusy(false);
        toast({
          title: poner.length ? 'Se agregaron las personas nuevas, pero no se quitaron las otras' : 'No se pudo cambiar quién lo hace',
          description: error.message, variant: 'destructive',
        });
        onSaved(false);
        return;
      }
    }
    setBusy(false);
    onSaved(true);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quién hace «{line.product.name}»</DialogTitle>
          <DialogDescription>Marca a todas las personas que lo hacen. Se puede cambiar hasta que se cobre la orden.</DialogDescription>
        </DialogHeader>
        <PersonasCasillas staff={staff} value={ids} onChange={setIds} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || (poner.length === 0 && quitar.length === 0)}>
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
