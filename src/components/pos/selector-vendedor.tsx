'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Vendedor } from '@/hooks/use-vendedores';

/**
 * "¿Quién vendió?" en el cobro, con el módulo de comisiones encendido. Arranca
 * en quien cobra; el cajero cambia cuando la venta la hizo otro. La comisión la
 * calcula la base con el % que el vendedor tenga ese día.
 */
export function SelectorVendedor({
  vendedores,
  value,
  onChange,
  yo,
}: {
  vendedores: Vendedor[];
  value: string;
  onChange: (id: string) => void;
  yo: { id: string; name: string };
}) {
  // Quien cobra va siempre, aunque no salga en la lista (super admin de
  // plataforma sin membresía): es el valor por defecto.
  const activos = vendedores.filter((v) => v.activo && v.id !== yo.id);
  return (
    <div>
      <Label htmlFor="vendedor">Vendedor</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="vendedor" className="mt-2">
          <SelectValue placeholder="¿Quién hizo la venta?" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={yo.id}>{yo.name} (yo)</SelectItem>
          {activos.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">
        La comisión de esta venta se le acredita a quien elijas.
      </p>
    </div>
  );
}
