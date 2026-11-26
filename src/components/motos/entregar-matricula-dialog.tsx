'use client';

import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { entregaDeMatricula, vehicleLabel } from '@/lib/motos';
import { ConstanciaEntrega, entregaGuardada, type DatosEntrega } from '@/components/motos/constancia-entrega';
import type { Vehicle } from '@/lib/types';

interface Props {
  vehicle: Vehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntregar: (v: Vehicle, recibe: string, cedula: string, motivoForzado?: string) => Promise<void>;
}

// Entregar la matrícula y, al terminar, imprimir la constancia. Si la matrícula
// ya se entregó, abre directo la constancia para reimprimirla.
export function EntregarMatriculaDialog({ vehicle, open, onOpenChange, onEntregar }: Props) {
  const { toast } = useToast();
  const { appUser } = useAuth();
  const esAdmin = !!appUser?.isCompanyAdmin || !!appUser?.isSuperAdmin;
  const [recibe, setRecibe] = useState('');
  const [cedula, setCedula] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [hecha, setHecha] = useState<DatosEntrega | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const imprimir = useReactToPrint({ content: () => printRef.current });

  useEffect(() => {
    if (!open || !vehicle) return;
    setRecibe(vehicle.customerName ?? '');
    setCedula('');
    setMotivo('');
    setHecha(vehicle.registrationStatus === 'entregada' ? entregaGuardada(vehicle) : null);
  }, [open, vehicle]);

  if (!vehicle) return null;
  const regla = entregaDeMatricula(vehicle, esAdmin);
  const listo = !!recibe.trim() && regla.puede && (!regla.forzada || !!motivo.trim());

  const entregar = async () => {
    if (!listo) return;
    setSaving(true);
    try {
      await onEntregar(vehicle, recibe.trim(), cedula.trim(), regla.forzada ? motivo.trim() : undefined);
      setHecha({ recibe: recibe.trim(), cedula: cedula.trim() || undefined, fecha: new Date(), entregadoPor: appUser?.name });
      toast({ title: 'Matrícula entregada', description: `A ${recibe.trim()}.` });
    } catch (e: any) {
      toast({ title: 'No se pudo entregar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{hecha ? 'Constancia de entrega' : 'Entregar matrícula'}</DialogTitle>
          <DialogDescription>{vehicleLabel(vehicle)} · Chasis {vehicle.chassis ?? '—'}</DialogDescription>
        </DialogHeader>

        {hecha ? (
          <>
            <div className="rounded-md border">
              <ConstanciaEntrega ref={printRef} vehicle={vehicle} datos={hecha} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
              <Button onClick={imprimir}><Printer className="mr-2 h-4 w-4" /> Imprimir constancia</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="grid gap-3">
              {regla.aviso && (
                <p className={regla.puede ? 'text-sm text-amber-700 dark:text-amber-300' : 'text-sm text-destructive'}>{regla.aviso}</p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="mat-recibe">Quién la retira <span className="text-destructive">*</span></Label>
                <Input id="mat-recibe" value={recibe} onChange={(e) => setRecibe(e.target.value)} disabled={!regla.puede} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mat-cedula">Cédula de quien la retira</Label>
                <Input id="mat-cedula" value={cedula} onChange={(e) => setCedula(e.target.value)} disabled={!regla.puede} />
              </div>
              {regla.forzada && (
                <div className="grid gap-1.5">
                  <Label htmlFor="mat-motivo">Motivo de la entrega con deuda <span className="text-destructive">*</span></Label>
                  <Textarea id="mat-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={entregar} disabled={!listo || saving}>{saving ? 'Entregando…' : 'Entregar'}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
