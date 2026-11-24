'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rangoDelPeriodo, type Periodo } from '@/lib/cobranza';
import { hoyLocal } from '@/lib/subscription-status';

export type Rango = { desde: string; hasta: string };

const OPCIONES: { valor: Periodo | 'otro'; texto: string }[] = [
  { valor: 'hoy', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
  { valor: 'mes_pasado', texto: 'Mes pasado' },
  { valor: '30', texto: 'Últimos 30 días' },
  { valor: 'otro', texto: 'Otras fechas' },
];

/** Período de los reportes de cobranza: los de siempre o dos fechas a mano. */
export function PeriodoSelector({ value, onChange }: { value: Rango; onChange: (r: Rango) => void }) {
  const [opcion, setOpcion] = useState<Periodo | 'otro'>('mes');
  const elegir = (v: string) => {
    const o = v as Periodo | 'otro';
    setOpcion(o);
    if (o !== 'otro') onChange(rangoDelPeriodo(o, hoyLocal()));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={opcion} onValueChange={elegir}>
        <SelectTrigger className="w-44" aria-label="Período"><SelectValue /></SelectTrigger>
        <SelectContent>
          {OPCIONES.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.texto}</SelectItem>)}
        </SelectContent>
      </Select>
      {opcion === 'otro' && (
        <>
          <Input type="date" className="w-40" aria-label="Desde" value={value.desde} max={value.hasta}
            onChange={(e) => e.target.value && onChange({ ...value, desde: e.target.value })} />
          <Input type="date" className="w-40" aria-label="Hasta" value={value.hasta} min={value.desde}
            onChange={(e) => e.target.value && onChange({ ...value, hasta: e.target.value })} />
        </>
      )}
    </div>
  );
}
