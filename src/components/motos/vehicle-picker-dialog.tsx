'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCart } from '@/context/cart-provider';
import { useVehiculos } from '@/hooks/use-vehiculos';
import { formatCurrency } from '@/lib/utils';
import { matchesVehicle, vehicleLabel } from '@/lib/motos';

// El POS lo monta una vez. Cuando alguien agrega un artículo-vehículo (tarjeta,
// búsqueda o código), el carrito no lo agrega suelto: deja el artículo en
// `vehiclePickFor` y aquí se elige cuál unidad (chasis) sale.
export function VehiclePickerHost() {
  const { vehiclePickFor: product, closeVehiclePick, addVehicleItem, carts } = useCart();
  const { vehicles, loading, reload } = useVehiculos();
  const [q, setQ] = useState('');

  useEffect(() => {
    if (product) { setQ(''); reload(); }
  }, [product, reload]);

  // Una unidad que ya está en algún carrito no se ofrece otra vez.
  const enCarritos = useMemo(
    () => new Set(carts.flatMap((c) => c.items.map((i) => i.vehicleId).filter(Boolean) as string[])),
    [carts],
  );
  const opciones = useMemo(
    () => vehicles
      .filter((v) => v.productId === product?.id && v.status === 'disponible' && !enCarritos.has(v.id))
      .filter((v) => matchesVehicle(v, q)),
    [vehicles, product, enCarritos, q],
  );

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && closeVehiclePick()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Elige el chasis</DialogTitle>
          <DialogDescription>{product?.name}: cada moto se vende con su chasis.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Buscar chasis, color o año…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando unidades…</p>
          ) : opciones.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay unidades disponibles de {product?.name}. Ingrésalas desde Vehículos.
            </p>
          ) : opciones.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => product && addVehicleItem(product, v)}
              className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted"
            >
              <span>
                <span className="block font-mono text-sm font-medium">{v.chassis ?? '(sin chasis)'}</span>
                <span className="block text-xs text-muted-foreground">{vehicleLabel(v)}{v.engineNumber ? ` · Motor ${v.engineNumber}` : ''}</span>
              </span>
              <span className="whitespace-nowrap text-sm font-semibold">{formatCurrency(v.price ?? product?.price ?? 0)}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeVehiclePick}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
