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
import { parseMonto } from '@/lib/motos';
import { formatCurrency, cn } from '@/lib/utils';
import type { EntregaRecibida } from '@/lib/types';

interface Props {
  cobrador: { id: string; name: string } | null;
  esperado: number;
  abonos: number;
  usaCaja: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecibir: (collectorId: string, recibido: number, nota?: string) => Promise<EntregaRecibida>;
}

// Recibir la entrega del cobrador: se cuenta el efectivo y se declara lo
// recibido. La diferencia queda a su cargo y sale en el historial; la base
// vuelve a sumar lo esperado al confirmar.
export function EntregaDialog({ cobrador, esperado, abonos, usaCaja, open, onOpenChange, onRecibir }: Props) {
  const { toast } = useToast();
  const [recibido, setRecibido] = useState('');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecibido('');
    setNota('');
  }, [open]);

  if (!cobrador) return null;
  const valor = parseMonto(recibido);
  const valido = valor !== undefined && !Number.isNaN(valor) && valor >= 0;
  const diferencia = valido ? Math.round((valor! - esperado) * 100) / 100 : null;
  const listo = valido && (diferencia === 0 || !!nota.trim());

  const recibir = async () => {
    if (!listo || valor === undefined) return;
    setSaving(true);
    try {
      const r = await onRecibir(cobrador.id, valor, nota);
      toast({
        title: 'Entrega recibida',
        description: r.difference === 0
          ? `${cobrador.name}: ${formatCurrency(r.received)}, cuadrado.`
          : `${cobrador.name}: ${formatCurrency(r.received)} de ${formatCurrency(r.expected)} (diferencia ${formatCurrency(r.difference)}).`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'No se pudo recibir', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recibir entrega · {cobrador.name}</DialogTitle>
          <DialogDescription>
            {abonos} {abonos === 1 ? 'abono' : 'abonos'} en efectivo sin entregar, por {formatCurrency(esperado)}.
            {usaCaja ? ' Lo recibido entra a la caja abierta de esta sucursal.' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="entrega-recibido">Efectivo recibido <span className="text-destructive">*</span></Label>
            <Input id="entrega-recibido" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(e.target.value)} autoFocus />
            {recibido.trim() !== '' && !valido && <p className="text-sm text-destructive">Escribe un monto válido, como 7,700.</p>}
          </div>
          {diferencia !== null && (
            <p className={cn('rounded-md p-2 text-sm', diferencia === 0
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100')}>
              {diferencia === 0
                ? 'Cuadra con lo cobrado.'
                : diferencia < 0
                  ? `Faltan ${formatCurrency(-diferencia)}: quedan a cargo del cobrador.`
                  : `Sobran ${formatCurrency(diferencia)}.`}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="entrega-nota">Nota {diferencia !== null && diferencia !== 0 && <span className="text-destructive">*</span>}</Label>
            <Textarea id="entrega-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder={diferencia ? 'Explica la diferencia' : undefined} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={recibir} disabled={!listo || saving}>{saving ? 'Recibiendo…' : 'Confirmar entrega'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
