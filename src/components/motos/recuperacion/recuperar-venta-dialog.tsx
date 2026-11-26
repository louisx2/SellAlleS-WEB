'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { parseMonto } from '@/lib/motos';
import { hoyLocal } from '@/lib/subscription-status';
import { cn, formatCurrency } from '@/lib/utils';
import { montoNotaDeRecuperacion } from '@/lib/motos-recuperacion';
import type { RecuperarVentaInput, ResultadoNotaDeCredito, ResultadoRecuperarVenta } from '@/hooks/use-recuperaciones';

interface Props {
  nombre: string;
  /** Lo que el cliente no pagó de la venta: se da de baja. */
  deuda: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecuperar: (input: RecuperarVentaInput) => Promise<ResultadoRecuperarVenta>;
  /** La venta lleva NCF: se ofrece la nota de crédito por lo no cobrado (4B). */
  conComprobante?: boolean;
  /** Total de la factura y total a pagar (con intereses si es financiada), para la vista previa. */
  totalFacturado?: number;
  totalAPagar?: number;
  /** Emite la nota después de recuperar; si falla, la recuperación queda. */
  emitirNota?: () => Promise<ResultadoNotaDeCredito>;
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

// La moto vendida a crédito vuelve al inventario como usada. Lo que el cliente
// no pagó se da de baja y la venta queda «Recuperada» (no se cobra ni se anula).
export function RecuperarVentaDialog({
  nombre, deuda, open, onOpenChange, onRecuperar, conComprobante = false, totalFacturado = 0, totalAPagar = 0, emitirNota,
}: Props) {
  const { toast } = useToast();
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [estado, setEstado] = useState('');
  const [valor, setValor] = useState('');
  const [devolver, setDevolver] = useState(false);
  const [devolucion, setDevolucion] = useState('');
  const [metodo, setMetodo] = useState<'cash' | 'transfer'>('cash');
  const [nota, setNota] = useState('');
  const [conNota, setConNota] = useState(false);
  const [saving, setSaving] = useState(false);
  const ofreceNota = conComprobante && !!emitirNota;

  useEffect(() => {
    if (!open) return;
    setFecha(hoyLocal());
    setMotivo('');
    setEstado('');
    setValor('');
    setDevolver(false);
    setDevolucion('');
    setMetodo('cash');
    setNota('');
    setConNota(ofreceNota);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reingreso = parseMonto(valor);
  const reingresoValido = reingreso !== undefined && !Number.isNaN(reingreso) && reingreso >= 0;
  const monto = parseMonto(devolucion);
  const devolucionValida = !devolver || (monto !== undefined && !Number.isNaN(monto) && monto > 0);
  const listo = !!fecha && fecha <= hoyLocal() && !!motivo.trim() && reingresoValido && devolucionValida;
  const montoNota = montoNotaDeRecuperacion({
    totalFacturado, totalAPagar, dadoDeBaja: deuda,
    devuelto: devolver && monto !== undefined && !Number.isNaN(monto) ? monto : 0,
  });

  const guardar = async () => {
    if (!listo) return;
    setSaving(true);
    try {
      const r = await onRecuperar({
        fecha, motivo, estado, nota,
        valorReingreso: reingreso!,
        devolucion: devolver ? monto! : 0,
        devolucionMetodo: metodo,
      });
      const partes = [`Vuelve al inventario. Se dieron de baja ${formatCurrency(r.deuda)}.`];
      if (r.devuelto > 0) partes.push(`Se le devolvieron ${formatCurrency(r.devuelto)} al cliente.`);
      toast({ title: 'Moto recuperada', description: partes.join(' ') });
      if (conNota && emitirNota) {
        try {
          const n = await emitirNota();
          toast({ title: 'Nota de crédito emitida', description: `${n.ncf ?? 'Nota'} por ${formatCurrency(n.total)}.` });
        } catch (e: any) {
          toast({
            title: 'La moto se recuperó, pero la nota de crédito no se pudo emitir',
            description: `${e?.message ?? 'Inténtalo de nuevo.'} Emítela desde la venta.`,
            variant: 'destructive',
          });
        }
      }
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'No se pudo recuperar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recuperar el vehículo · {nombre}</DialogTitle>
          <DialogDescription>
            La moto vuelve al inventario como usada, con el valor de reingreso como costo. La venta queda «Recuperada»: ya no se cobra ni se anula.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="recuperar-fecha">Fecha <span className="text-destructive">*</span></Label>
              <Input id="recuperar-fecha" type="date" max={hoyLocal()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recuperar-valor">Valor de reingreso <span className="text-destructive">*</span></Label>
              <Input id="recuperar-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            {fecha > hoyLocal() && <p className="col-span-2 text-sm text-destructive">La fecha no puede ser futura.</p>}
            {valor.trim() !== '' && !reingresoValido && <p className="col-span-2 text-sm text-destructive">Escribe un monto válido, como 50,000.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recuperar-motivo">Motivo <span className="text-destructive">*</span></Label>
            <Textarea id="recuperar-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Dejó de pagar, la devolvió…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recuperar-estado">Estado de la moto</Label>
            <Input id="recuperar-estado" value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Rayada, sin batería…" />
          </div>

          <div className="flex justify-between rounded-md border bg-muted/40 p-3 text-sm">
            <span>Se da de baja (lo que no pagó)</span>
            <span className="font-medium">{formatCurrency(deuda)}</span>
          </div>

          <div className="grid gap-1.5">
            <Label>¿Se le devuelve algo al cliente?</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Devolución">
              <Opcion activo={!devolver} onClick={() => setDevolver(false)} titulo="No" />
              <Opcion activo={devolver} onClick={() => setDevolver(true)} titulo="Sí" />
            </div>
          </div>
          {devolver && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="recuperar-devolucion">Monto <span className="text-destructive">*</span></Label>
                <Input id="recuperar-devolucion" inputMode="decimal" value={devolucion} onChange={(e) => setDevolucion(e.target.value)} />
                {devolucion.trim() !== '' && !devolucionValida && <p className="text-sm text-destructive">Escribe un monto válido, como 5,000.</p>}
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Método de la devolución">
                <Opcion activo={metodo === 'cash'} onClick={() => setMetodo('cash')} titulo="Efectivo" detalle="Sale de la caja" />
                <Opcion activo={metodo === 'transfer'} onClick={() => setMetodo('transfer')} titulo="Transferencia" />
              </div>
            </div>
          )}

          {ofreceNota && (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox checked={conNota} onCheckedChange={(v) => setConNota(v === true)} className="mt-0.5" />
              <span>
                Emitir nota de crédito por lo no cobrado ({formatCurrency(montoNota)})
                <span className="block text-xs text-muted-foreground">
                  B04 o E34 según el comprobante de la venta. Si no sale ahora, se emite después desde la venta.
                </span>
              </span>
            </label>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="recuperar-nota">Nota</Label>
            <Textarea id="recuperar-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={!listo || saving}>{saving ? 'Guardando…' : 'Recuperar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
