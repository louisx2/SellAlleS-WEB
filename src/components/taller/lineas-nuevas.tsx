'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { ServiceType, Staff } from '@/lib/types';
import { SELECT_CLASS } from './ficha-picker';

/** Un servicio del catálogo en una orden nueva: su precio y quién lo hace. */
export type LineaNueva = { serviceTypeId: string; staffIds: string[]; price: number };

/** Precio editable: mientras se escribe se respeta el texto («12.»), al salir se
 *  muestra el número. Así funciona aunque las líneas se identifiquen por posición. */
function PrecioInput({ value, onChange, label }: { value: number; onChange: (p: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      className="h-8 w-28 text-right"
      value={text ?? String(value)}
      onFocus={() => setText(String(value))}
      onBlur={() => setText(null)}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, '');
        setText(t);
        const p = Math.round(Number(t) * 100) / 100;
        if (Number.isFinite(p) && p >= 0) onChange(t === '' ? 0 : p);
      }}
    />
  );
}

/** Servicios de una orden nueva: cada línea con su precio y casillas de las
 *  personas que la hacen. `staff` son las personas activas de la sucursal. */
export function LineasNuevas({ catalog, staff, value, onChange, defaultStaffIds = [] }: {
  /** Servicios que se pueden agregar (activos y con artículo). */
  catalog: ServiceType[];
  staff: Staff[];
  value: LineaNueva[];
  onChange: (v: LineaNueva[]) => void;
  /** Quién hace una línea recién agregada. */
  defaultStaffIds?: string[];
}) {
  const uid = useId();
  const byId = new Map(catalog.map((s) => [s.id, s]));

  const set = (i: number, patch: Partial<LineaNueva>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const agregar = (id: string) => {
    const s = byId.get(id);
    if (!s) return;
    const staffIds = defaultStaffIds.filter((x) => staff.some((p) => p.id === x));
    onChange([...value, { serviceTypeId: s.id, staffIds, price: s.price }]);
  };

  // El orden importa: la primera persona de la primera línea es la responsable.
  const persona = (i: number, id: string, on: boolean) => {
    const resto = value[i].staffIds.filter((x) => x !== id);
    set(i, { staffIds: on ? [...resto, id] : resto });
  };

  return (
    <div className="space-y-3">
      {value.map((l, i) => {
        const s = byId.get(l.serviceTypeId);
        const nombre = s?.name ?? 'Servicio';
        return (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{nombre}</p>
                {!!s?.durationMin && <p className="text-xs text-muted-foreground">{s.durationMin} min</p>}
              </div>
              <PrecioInput value={l.price} onChange={(p) => set(i, { price: p })} label={`Precio de ${nombre}`} />
              <Button
                type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                aria-label={`Quitar ${nombre}`} onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Trash className="h-4 w-4" />
              </Button>
            </div>
            {staff.length > 0 && (
              <fieldset>
                <legend className="mb-1.5 text-xs text-muted-foreground">Lo hace</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {staff.map((p) => {
                    const id = `${uid}-${i}-${p.id}`;
                    return (
                      <label key={p.id} htmlFor={id} className="flex items-center gap-2 text-sm">
                        <Checkbox id={id} checked={l.staffIds.includes(p.id)} onCheckedChange={(v) => persona(i, p.id, v === true)} />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
        );
      })}

      {catalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay servicios en el catálogo. <Link href="/service-types" className="underline">Agrégalos</Link>.
        </p>
      ) : (
        <select aria-label="Agregar servicio" className={SELECT_CLASS} value="" onChange={(e) => agregar(e.target.value)}>
          <option value="">+ Agregar servicio del catálogo</option>
          {catalog.map((s) => <option key={s.id} value={s.id}>{s.name} · {formatCurrency(s.price)}</option>)}
        </select>
      )}
    </div>
  );
}
