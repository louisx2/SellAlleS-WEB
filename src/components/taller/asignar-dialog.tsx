'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Service, Staff } from '@/lib/types';
import { SELECT_CLASS } from './ficha-picker';

/** Pone (o quita, con null) a la persona responsable de la orden. Queda en el
 *  historial con la nota. Quien se la pasa a otro puede dejar de verla. */
export async function asignarOrden(serviceId: string, staffId: string | null, note?: string) {
  return supabase.rpc('servicios_asignar', {
    p_service_id: serviceId, p_staff_id: staffId, p_note: note?.trim() || null,
  });
}

/** «Lo atiende»: elegir a la persona responsable entre el personal activo de la
 *  sucursal de la orden. `staff` ya viene filtrado (activas y de esa sucursal).
 *  Se monta al abrirse. */
export function AsignarDialog({ service, staff, otraSucursal, onClose, onAssigned }: {
  service: Service;
  staff: Staff[];
  /** Nombre de la sucursal de la orden cuando no es la activa: su personal no está cargado. */
  otraSucursal?: string;
  onClose: () => void;
  onAssigned: (staffId: string | null) => void;
}) {
  const { toast } = useToast();
  const actual = service.staffId ?? '';
  const [to, setTo] = useState(actual);
  // La responsable de hoy puede no estar en la lista (ya no está activa).
  const fuera = !!actual && !staff.some((p) => p.id === actual);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const { error } = await asignarOrden(service.id, to || null, note);
    setBusy(false);
    if (error) { toast({ title: 'No se pudo asignar', description: error.message, variant: 'destructive' }); return; }
    onAssigned(to || null);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{service.staffId ? 'Pasar a otra persona' : 'Asignar la orden'}</DialogTitle>
          <DialogDescription>Queda anotado en el historial, con el motivo si lo escribes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {otraSucursal ? (
            <p className="text-sm text-muted-foreground">
              Esta orden es de la sucursal {otraSucursal}. Para elegir quién la atiende, cambia a esa sucursal.
            </p>
          ) : (
            <>
              {staff.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay personal activo en esta sucursal. Agrégalo en{' '}
                  <Link className="underline" href="/service-types">Configuración de Servicios → Personal</Link>.
                </p>
              )}
              {/* Con una persona que ya no está activa, igual se puede dejar sin asignar. */}
              {(staff.length > 0 || actual) && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="asignar-a">Lo atiende</Label>
                    <select id="asignar-a" className={SELECT_CLASS} value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="">Sin asignar</option>
                      {fuera && <option value={actual} disabled>{service.staff?.name ?? 'Otra persona'} (ya no está activa)</option>}
                      {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Input aria-label="Motivo" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (opcional)" />
                </>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !!otraSucursal || to === actual}>
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
