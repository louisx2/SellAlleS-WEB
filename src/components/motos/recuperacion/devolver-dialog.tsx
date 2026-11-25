'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface Props {
  nombre: string;
  /** El préstamo sigue activo: la moto vuelve a quedar en garantía. Si no, se libera. */
  prestamoActivo: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDevolver: (nota: string) => Promise<void>;
}

// El cliente se puso al día (o saldó): la moto sale del patio y vuelve con él.
export function DevolverDialog({ nombre, prestamoActivo, open, onOpenChange, onDevolver }: Props) {
  const { toast } = useToast();
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setNota(''); }, [open]);

  const guardar = async () => {
    setSaving(true);
    try {
      await onDevolver(nota);
      toast({
        title: 'Moto devuelta',
        description: prestamoActivo ? `${nombre} vuelve a estar en garantía del préstamo.` : `${nombre} quedó liberada.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'No se pudo devolver', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Devolver al cliente · {nombre}</DialogTitle>
          <DialogDescription>
            {prestamoActivo
              ? 'La moto vuelve con el cliente y sigue en garantía del préstamo.'
              : 'El préstamo ya no está activo: la moto se libera y, si la matrícula estaba en custodia, queda lista para entregar.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="devolver-nota">Nota</Label>
          <Textarea id="devolver-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Se puso al día, pagó la mora…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Devolver'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
