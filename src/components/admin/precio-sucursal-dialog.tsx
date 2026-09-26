'use client';

// Precio acordado de una sucursal (branches.cuota_mensual). Reemplaza la
// tarifa del plan solo para esa sucursal y rige para todas sus cuotas, también
// las ya vencidas: la cuenta no guarda historial de precios.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import type { PrecioSucursal } from '@/components/admin/cobros-fila';

export function PrecioSucursalDialog({ sucursal, onClose, onDone }: {
  sucursal: PrecioSucursal | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [precio, setPrecio] = useState<number | ''>('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (sucursal) setPrecio(sucursal.precio ?? '');
  }, [sucursal]);

  const guardar = async (valor: number | null) => {
    if (!sucursal) return;
    if (valor != null && (!Number.isFinite(valor) || valor < 0)) {
      toast({ title: 'Precio inválido', description: 'Escribe un monto de 0 en adelante.', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    const { error } = await supabase.rpc('poner_cuota_de_sucursal', { p_branch_id: sucursal.id, p_cuota: valor });
    setGuardando(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Precio actualizado',
      description: valor == null
        ? `${sucursal.nombre} vuelve a pagar la tarifa del plan (${formatCurrency(sucursal.tarifa)}).`
        : valor === 0
          ? `${sucursal.nombre} ya no se cobra.`
          : `${sucursal.nombre} paga ${formatCurrency(valor)} al mes.`,
    });
    onDone();
    onClose();
  };

  const valor = precio === '' ? null : Number(precio);

  return (
    <Dialog open={!!sucursal} onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Precio de {sucursal?.nombre}</DialogTitle>
          <DialogDescription>
            La tarifa del plan es {sucursal ? formatCurrency(sucursal.tarifa) : ''} al mes por sucursal. Un precio
            propio la reemplaza solo para esta sucursal y rige para todas sus cuotas, también las ya vencidas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="ps-precio">Precio al mes</Label>
          <Input
            id="ps-precio" type="number" inputMode="decimal" step="0.01" min="0" autoFocus
            placeholder={sucursal ? `Vacío: ${formatCurrency(sucursal.tarifa)} (tarifa del plan)` : ''}
            value={precio}
            onChange={(e) => setPrecio(e.target.value === '' ? '' : Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">0 = no se le cobra.</p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost" onClick={() => guardar(null)}
            disabled={guardando || sucursal?.precio == null}
          >
            Usar la tarifa del plan
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
            <Button onClick={() => guardar(valor)} disabled={guardando || valor == null}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
