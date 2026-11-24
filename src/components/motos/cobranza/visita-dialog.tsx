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
import { TEXTO_RESULTADO } from '@/lib/cobranza';
import { hoyLocal } from '@/lib/subscription-status';
import { cn } from '@/lib/utils';
import type { VisitaNueva } from '@/hooks/use-cobranza';

const RESULTADOS: VisitaNueva['outcome'][] = ['no_estaba', 'no_tenia', 'promesa', 'se_nego', 'moto_no_aparece'];

interface Props {
  customerId: string | null;
  nombre: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGuardar: (visita: VisitaNueva) => Promise<void>;
}

// «No pagó»: qué pasó en la visita. Una promesa lleva fecha (y, si la dijo,
// monto) y el cliente sale en la ruta de ese día.
export function VisitaDialog({ customerId, nombre, open, onOpenChange, onGuardar }: Props) {
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<VisitaNueva['outcome']>('no_estaba');
  const [fecha, setFecha] = useState('');
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOutcome('no_estaba');
    setFecha('');
    setMonto('');
    setNota('');
  }, [open]);

  if (!customerId) return null;
  const valor = parseMonto(monto);
  const montoValido = valor === undefined || (!Number.isNaN(valor) && valor > 0);
  const fechaValida = outcome !== 'promesa' || (!!fecha && fecha >= hoyLocal());
  const listo = fechaValida && (outcome !== 'promesa' || montoValido);

  const guardar = async () => {
    if (!listo) return;
    setSaving(true);
    try {
      await onGuardar({
        customerId, outcome, note: nota,
        promiseDate: outcome === 'promesa' ? fecha : undefined,
        promiseAmount: outcome === 'promesa' && valor !== undefined && !Number.isNaN(valor) ? valor : undefined,
      });
      toast({ title: 'Visita anotada', description: `${nombre}: ${TEXTO_RESULTADO[outcome]}.` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'No se pudo anotar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>No pagó · {nombre}</DialogTitle>
          <DialogDescription>Queda anotado en el historial de visitas del cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Qué pasó">
            {RESULTADOS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={outcome === r}
                onClick={() => setOutcome(r)}
                className={cn('rounded-md border p-2 text-sm', outcome === r ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted')}
              >
                {TEXTO_RESULTADO[r]}
              </button>
            ))}
          </div>
          {outcome === 'promesa' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="visita-fecha">Paga el <span className="text-destructive">*</span></Label>
                <Input id="visita-fecha" type="date" min={hoyLocal()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="visita-monto">Monto</Label>
                <Input id="visita-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
              </div>
              {!montoValido && <p className="col-span-2 text-sm text-destructive">Escribe un monto válido, como 1,000.</p>}
              {fecha && fecha < hoyLocal() && <p className="col-span-2 text-sm text-destructive">La fecha de la promesa no puede ser pasada.</p>}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="visita-nota">Nota</Label>
            <Textarea id="visita-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={!listo || saving}>{saving ? 'Guardando…' : 'Anotar visita'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
