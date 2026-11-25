'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { hoyLocal } from '@/lib/subscription-status';
import type { IncautarInput } from '@/hooks/use-recuperaciones';

interface Props {
  nombre: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIncautar: (input: IncautarInput) => Promise<void>;
}

// La moto en garantía se trae al patio. El préstamo sigue corriendo: el cliente
// puede ponerse al día y llevársela, o se liquida la garantía.
export function IncautarDialog({ nombre, open, onOpenChange, onIncautar }: Props) {
  const { toast } = useToast();
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFecha(hoyLocal());
    setMotivo('');
    setNota('');
  }, [open]);

  const listo = !!fecha && fecha <= hoyLocal() && !!motivo.trim();

  const guardar = async () => {
    if (!listo) return;
    setSaving(true);
    try {
      await onIncautar({ fecha, motivo, nota });
      toast({ title: 'Moto incautada', description: `${nombre} quedó en el patio. El préstamo sigue activo.` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'No se pudo incautar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incautar · {nombre}</DialogTitle>
          <DialogDescription>
            La moto pasa a «Recuperado» y el préstamo sigue activo. Después se devuelve al cliente o se liquida la garantía.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="incautar-fecha">Fecha <span className="text-destructive">*</span></Label>
            <Input id="incautar-fecha" type="date" max={hoyLocal()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            {fecha > hoyLocal() && <p className="text-sm text-destructive">La fecha no puede ser futura.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="incautar-motivo">Motivo <span className="text-destructive">*</span></Label>
            <Textarea id="incautar-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Atraso de 3 cuotas, no contesta…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="incautar-nota">Nota</Label>
            <Textarea id="incautar-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Dónde quedó, en qué estado llegó…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={!listo || saving}>{saving ? 'Guardando…' : 'Incautar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
