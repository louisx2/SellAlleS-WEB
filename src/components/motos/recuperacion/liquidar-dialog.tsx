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
import { repartoDeLiquidacion } from '@/lib/motos-recuperacion';
import { cn, formatCurrency } from '@/lib/utils';
import type { LiquidarInput, ResultadoLiquidacion } from '@/hooks/use-recuperaciones';

interface Props {
  nombre: string;
  /** Artículos-vehículo de la sucursal de la moto (a uno entra en la dación). */
  productos: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deuda del préstamo con la mora de hoy (la da la base). */
  cargarDeuda: () => Promise<number>;
  onLiquidar: (input: LiquidarInput) => Promise<ResultadoLiquidacion>;
}

function Opcion({ activo, onClick, titulo, detalle }: { activo: boolean; onClick: () => void; titulo: string; detalle?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      onClick={onClick}
      className={cn('rounded-md border p-2 text-left text-sm', activo ? 'border-primary bg-primary/5' : 'hover:bg-muted')}
    >
      <span className={cn('block', activo && 'font-medium')}>{titulo}</span>
      {detalle && <span className="block text-xs text-muted-foreground">{detalle}</span>}
    </button>
  );
}

// La garantía incautada se liquida: se vende a un tercero (lo que paga se abona
// al préstamo, sin factura) o se la queda el negocio (dación en pago: entra al
// inventario por la tasación). Lo que sobre es del cliente; lo que falte queda
// como deuda o se da de baja.
export function LiquidarDialog({ nombre, productos, open, onOpenChange, cargarDeuda, onLiquidar }: Props) {
  const { toast } = useToast();
  const [deuda, setDeuda] = useState<number | null>(null);
  const [errorDeuda, setErrorDeuda] = useState('');
  const [modo, setModo] = useState<LiquidarInput['modo']>('tercero');
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<LiquidarInput['metodo']>('cash');
  const [referencia, setReferencia] = useState('');
  const [productId, setProductId] = useState('');
  const [faltante, setFaltante] = useState<LiquidarInput['faltante']>('deuda');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setModo('tercero');
    setMonto('');
    setMetodo('cash');
    setReferencia('');
    setProductId(productos.length === 1 ? productos[0].id : '');
    setFaltante('deuda');
    setNota('');
    setDeuda(null);
    setErrorDeuda('');
    cargarDeuda().then(setDeuda).catch((e: any) => setErrorDeuda(e?.message ?? 'No se pudo leer la deuda del préstamo.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valor = parseMonto(monto);
  const montoValido = valor !== undefined && !Number.isNaN(valor) && valor > 0;
  const reparto = deuda !== null && montoValido ? repartoDeLiquidacion(deuda, valor!) : null;
  const pideMetodo = modo === 'tercero' || (reparto?.sobrante ?? 0) > 0;
  const listo = deuda !== null && montoValido && (modo === 'tercero' || !!productId);

  const guardar = async () => {
    if (!listo) return;
    setSaving(true);
    try {
      const r = await onLiquidar({
        modo, monto: valor!, metodo, faltante, nota,
        productId: modo === 'dacion' ? productId : undefined,
        referencia: modo === 'tercero' && metodo === 'transfer' ? referencia : undefined,
      });
      const partes = [`Se aplicaron ${formatCurrency(r.aplicado)} al préstamo.`];
      if (r.sobrante > 0) partes.push(`Sobran ${formatCurrency(r.sobrante)} para el cliente.`);
      if (r.faltante > 0) partes.push(faltante === 'baja' ? `Se dieron de baja ${formatCurrency(r.faltante)}.` : `Quedan ${formatCurrency(r.faltante)} de deuda.`);
      toast({ title: 'Garantía liquidada', description: partes.join(' ') });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'No se pudo liquidar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Liquidar la garantía · {nombre}</DialogTitle>
          <DialogDescription>
            {deuda !== null
              ? <>Deuda del préstamo con la mora de hoy: <span className="font-medium text-foreground">{formatCurrency(deuda)}</span></>
              : errorDeuda || 'Leyendo la deuda del préstamo…'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Qué se hace con la moto">
            <Opcion activo={modo === 'tercero'} onClick={() => setModo('tercero')} titulo="Vender a un tercero" detalle="Lo que pague se abona al préstamo" />
            <Opcion activo={modo === 'dacion'} onClick={() => setModo('dacion')} titulo="Se la queda el negocio" detalle="Entra al inventario por la tasación" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="liquidar-monto">
              {modo === 'tercero' ? 'Lo que pagó el comprador' : 'Tasación'} <span className="text-destructive">*</span>
            </Label>
            <Input id="liquidar-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
            {monto.trim() !== '' && !montoValido && <p className="text-sm text-destructive">Escribe un monto válido, como 45,000.</p>}
          </div>

          {modo === 'dacion' && (
            <div className="grid gap-1.5">
              <Label>Artículo al que entra <span className="text-destructive">*</span></Label>
              {productos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay artículos-vehículo en esta sucursal. Crea uno en Inventario con «Es vehículo» encendido.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Artículo al que entra">
                  {productos.map((p) => (
                    <Opcion key={p.id} activo={productId === p.id} onClick={() => setProductId(p.id)} titulo={p.name} />
                  ))}
                </div>
              )}
            </div>
          )}

          {reparto && (
            <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between"><span>Se aplica al préstamo</span><span className="font-medium">{formatCurrency(reparto.aplicado)}</span></div>
              {reparto.sobrante > 0 && (
                <div className="flex justify-between"><span>Sobra para el cliente</span><span className="font-medium">{formatCurrency(reparto.sobrante)}</span></div>
              )}
              {reparto.faltante > 0 && (
                <div className="flex justify-between"><span>Falta</span><span className="font-medium text-destructive">{formatCurrency(reparto.faltante)}</span></div>
              )}
              {reparto.sobrante > 0 && modo === 'tercero' && (
                <p className="text-xs text-muted-foreground">El sobrante se le entrega al cliente aparte: no pasa por la caja.</p>
              )}
            </div>
          )}

          {pideMetodo && (
            <div className="grid gap-1.5">
              <Label>{modo === 'tercero' ? '¿Cómo pagó el comprador?' : '¿Cómo se le devuelve el sobrante?'}</Label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Método">
                <Opcion activo={metodo === 'cash'} onClick={() => setMetodo('cash')} titulo="Efectivo" detalle={modo === 'dacion' ? 'Sale de la caja' : undefined} />
                <Opcion activo={metodo === 'transfer'} onClick={() => setMetodo('transfer')} titulo="Transferencia" />
              </div>
              {modo === 'tercero' && metodo === 'transfer' && (
                <Input aria-label="Referencia" placeholder="Referencia de la transferencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
              )}
            </div>
          )}

          {reparto && reparto.faltante > 0 && (
            <div className="grid gap-1.5">
              <Label>¿Qué se hace con lo que falta?</Label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Lo que falta">
                <Opcion activo={faltante === 'deuda'} onClick={() => setFaltante('deuda')} titulo="Dejarlo como deuda" detalle="El préstamo sigue activo" />
                <Opcion activo={faltante === 'baja'} onClick={() => setFaltante('baja')} titulo="Darlo de baja" detalle="El préstamo se cierra" />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="liquidar-nota">Nota</Label>
            <Textarea id="liquidar-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder={modo === 'tercero' ? 'A quién se vendió…' : 'Quién la tasó…'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={!listo || saving}>{saving ? 'Guardando…' : 'Liquidar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
