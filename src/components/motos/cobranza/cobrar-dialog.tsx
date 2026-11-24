'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { ParadaDeRuta } from '@/lib/cobranza';
import type { CobroDeRuta } from '@/lib/types';
import type { AbonoDeRuta } from '@/hooks/use-cobranza';

type Opcion = { key: string; tipo: AbonoDeRuta['tipo']; id: string; titulo: string; detalle: string; sugerido: number };

interface Props {
  parada: ParadaDeRuta | null;
  nombre: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCobrar: (abono: AbonoDeRuta) => Promise<CobroDeRuta>;
}

const sugeridoDe = (c: ParadaDeRuta['cuentas'][number]) => Math.min(c.pendiente, c.cuota + c.mora);

// Cobrar en la calle: cada préstamo y cada venta por separado, o un abono
// general que reparte entre las ventas del cliente (como en Cuentas por Cobrar).
// En efectivo el dinero queda a cargo del cobrador hasta el cuadre.
export function CobrarDialog({ parada, nombre, open, onOpenChange, onCobrar }: Props) {
  const { toast } = useToast();
  const opciones = useMemo<Opcion[]>(() => {
    if (!parada) return [];
    const ops: Opcion[] = parada.cuentas.map((c, i) => ({
      key: `${c.tipo}-${c.id}`,
      tipo: c.tipo,
      id: c.id,
      titulo: c.tipo === 'prestamo' ? `Préstamo ${i + 1}` : `Venta ${i + 1}`,
      detalle: `Debe ${formatCurrency(c.pendiente)}${c.mora > 0 ? ` · mora ${formatCurrency(c.mora)}` : ''}`,
      sugerido: Math.round(sugeridoDe(c) * 100) / 100,
    }));
    const ventas = parada.cuentas.filter((c) => c.tipo === 'venta');
    if (ventas.length > 1) {
      ops.push({
        key: 'cliente',
        tipo: 'cliente',
        id: parada.customerId,
        titulo: 'Abono general a sus ventas',
        detalle: `Reparte entre ${ventas.length} ventas, la más vieja primero`,
        sugerido: Math.round(ventas.reduce((s, c) => s + sugeridoDe(c), 0) * 100) / 100,
      });
    }
    return ops;
  }, [parada]);

  const [elegida, setElegida] = useState<string>('');
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<'cash' | 'transfer'>('cash');
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [hecho, setHecho] = useState<CobroDeRuta | null>(null);
  // Uno por cobro: si la respuesta se pierde por la señal y se toca otra vez, la
  // base devuelve el abono que ya quedó en vez de crear otro.
  const requestId = useRef('');

  // Al abrir (no en cada recarga de la lista): la cuenta que más toca y su sugerido.
  useEffect(() => {
    if (!open) return;
    const primera = opciones.find((o) => o.sugerido > 0) ?? opciones[0];
    setElegida(primera?.key ?? '');
    setMonto(primera ? String(primera.sugerido) : '');
    setMetodo('cash');
    setReferencia('');
    setNota('');
    setHecho(null);
    requestId.current = crypto.randomUUID();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!parada) return null;
  const opcion = opciones.find((o) => o.key === elegida);
  const valor = parseMonto(monto);
  const montoValido = valor !== undefined && !Number.isNaN(valor) && valor > 0;
  const listo = !!opcion && montoValido && (metodo === 'cash' || !!referencia.trim());

  const elegir = (o: Opcion) => { setElegida(o.key); setMonto(String(o.sugerido)); };

  const cobrar = async () => {
    if (!listo || !opcion || valor === undefined) return;
    setSaving(true);
    try {
      const r = await onCobrar({ tipo: opcion.tipo, id: opcion.id, monto: valor, metodo, referencia, nota, requestId: requestId.current });
      setHecho(r);
      toast({ title: 'Abono registrado', description: `${formatCurrency(valor)} de ${nombre}.` });
    } catch (e: any) {
      toast({ title: 'No se pudo cobrar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{hecho ? 'Abono registrado' : `Cobrar a ${nombre}`}</DialogTitle>
          <DialogDescription>
            {hecho ? nombre : 'El monto sugerido es la cuota con la mora. Se puede cambiar.'}
          </DialogDescription>
        </DialogHeader>

        {hecho ? (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Aplicado a la deuda</dt><dd className="text-right font-medium">{formatCurrency(hecho.aplicado)}</dd>
              {hecho.mora > 0 && (<><dt className="text-muted-foreground">Mora</dt><dd className="text-right">{formatCurrency(hecho.mora)}</dd></>)}
              {hecho.saldo != null && (<><dt className="text-muted-foreground">Le queda debiendo</dt><dd className="text-right font-medium">{formatCurrency(hecho.saldo)}</dd></>)}
            </dl>
            {hecho.repetido && (
              <p className="rounded-md bg-muted p-2 text-sm">
                Este cobro ya se había registrado (se perdió la respuesta). No se cobró dos veces.
              </p>
            )}
            {hecho.enCalle && (
              <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
                Este efectivo queda a tu cargo hasta que lo entregues en el cuadre.
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Listo</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="grid gap-4">
              <div className="grid gap-2" role="radiogroup" aria-label="Qué se cobra">
                {opciones.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={elegida === o.key}
                    onClick={() => elegir(o)}
                    className={cn('rounded-md border p-3 text-left text-sm', elegida === o.key ? 'border-primary bg-primary/5' : 'hover:bg-muted')}
                  >
                    <span className="flex justify-between gap-2 font-medium">
                      <span>{o.titulo}</span><span>{formatCurrency(o.sugerido)}</span>
                    </span>
                    <span className="block text-muted-foreground">{o.detalle}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cobro-monto">Monto</Label>
                <Input id="cobro-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
                {monto.trim() !== '' && !montoValido && <p className="text-sm text-destructive">Escribe un monto válido, como 1,500 o 650.50.</p>}
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pago">
                {(['cash', 'transfer'] as const).map((m) => (
                  <Button key={m} type="button" variant={metodo === m ? 'default' : 'outline'} role="radio" aria-checked={metodo === m} onClick={() => setMetodo(m)}>
                    {m === 'cash' ? 'Efectivo' : 'Transferencia'}
                  </Button>
                ))}
              </div>
              {metodo === 'transfer' && (
                <div className="grid gap-1.5">
                  <Label htmlFor="cobro-ref">Referencia de la transferencia <span className="text-destructive">*</span></Label>
                  <Input id="cobro-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="cobro-nota">Nota</Label>
                <Textarea id="cobro-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={cobrar} disabled={!listo || saving}>{saving ? 'Cobrando…' : `Cobrar ${montoValido ? formatCurrency(valor!) : ''}`}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
