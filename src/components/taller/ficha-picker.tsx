'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import { rowToCustomerSubject } from '@/lib/supabase/mappers';
import { fichaFields } from '@/lib/taller';
import type { CustomerSubject, EquipmentType } from '@/lib/types';

/** Clases de `Input` para un `<select>` nativo (en Servicios no se usa el Select de Radix). */
export const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type FichaNueva = {
  mode: 'new';
  equipmentTypeId: string;
  brand: string;
  model: string;
  serial: string;
  details: Record<string, string>;
  notes: string;
};

/** Qué se atiende: nada, una ficha guardada del cliente o una ficha nueva. Una
 *  ficha guardada puede traer cambios para esta orden (la guardada no cambia). */
export type FichaValue = { mode: 'none' } | { mode: 'saved'; subject: CustomerSubject } | FichaNueva;

export const fichaNueva = (equipmentTypeId = ''): FichaNueva =>
  ({ mode: 'new', equipmentTypeId, brand: '', model: '', serial: '', details: {}, notes: '' });

export const tipoIdDeFicha = (v: FichaValue): string | undefined =>
  v.mode === 'saved' ? v.subject.equipmentTypeId : v.mode === 'new' ? v.equipmentTypeId || undefined : undefined;

type Campos = Pick<CustomerSubject, 'brand' | 'model' | 'serial' | 'details'>;

const camposDe = (v: FichaValue): Campos | null => (v.mode === 'saved' ? v.subject : v.mode === 'new' ? v : null);

const detallesLimpios = (d: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(d).map(([k, x]) => [k, String(x ?? '').trim()] as const).filter(([, x]) => x !== ''),
  );

/** Una ficha nueva sin ningún dato: no vale la pena guardarla en el cliente. */
export function fichaVacia(v: FichaNueva): boolean {
  return ![v.brand, v.model, v.serial, v.notes].some((x) => x.trim() !== '')
    && Object.keys(detallesLimpios(v.details)).length === 0;
}

/** La copia de la ficha que guarda la orden (`equipment_*`): cambiar la ficha
 *  después no cambia órdenes viejas. */
export function copiaDeFicha(v: FichaValue) {
  const c = camposDe(v);
  return {
    equipment_type_id: tipoIdDeFicha(v) ?? null,
    equipment_brand: c?.brand?.trim() || null,
    equipment_model: c?.model?.trim() || null,
    equipment_serial: c?.serial?.trim() || null,
    equipment_details: c ? detallesLimpios(c.details) : {},
  };
}

/** «Max · Poodle», «Honda · CG 150 · K123456»; sin datos, el nombre del tipo. */
export function etiquetaDeFicha(s: Campos, tipo?: Pick<EquipmentType, 'name'>): string {
  return [s.brand, s.model, s.serial].map((x) => x?.trim()).filter(Boolean).join(' · ') || tipo?.name || 'Ficha sin datos';
}

function Opcion({ name, checked, onSelect, title, hint }: {
  name: string; checked: boolean; onSelect: () => void; title: string; hint?: string;
}) {
  return (
    <label className={cn(
      'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
      checked ? 'border-primary bg-primary/5' : 'hover:bg-muted',
    )}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Elige qué se atiende. Con cliente salen sus fichas activas (de los tipos que se
 *  ofrecen); sin cliente, solo «nada» o una ficha nueva que queda solo en la orden.
 *  Guardar la ficha nueva en el cliente lo hace quien crea la orden. */
export function FichaPicker({ customerId, types, value, onChange, allowNone = true }: {
  customerId?: string;
  /** Tipos de ficha que se ofrecen (activos). */
  types: EquipmentType[];
  value: FichaValue;
  onChange: (v: FichaValue) => void;
  /** En una garantía hace falta la ficha. */
  allowNone?: boolean;
}) {
  const name = useId();
  const [saved, setSaved] = useState<CustomerSubject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSaved([]);
    setError(null);
    if (!customerId) { setLoading(false); return; }
    let vivo = true;
    setLoading(true);
    supabase.from('customer_subjects').select('*')
      .eq('customer_id', customerId).eq('is_active', true).order('created_at')
      .then(({ data, error: e }) => {
        if (!vivo) return;
        setLoading(false);
        if (e) { setError(e.message); return; }
        setSaved((data ?? []).map(rowToCustomerSubject));
      });
    return () => { vivo = false; };
  }, [customerId]);

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  // La elegida sale aunque no esté en la lista (recién guardada, o la de una garantía).
  const fichas = useMemo(() => {
    const list = saved.filter((s) => !!s.equipmentTypeId && typeById.has(s.equipmentTypeId));
    if (value.mode === 'saved' && !list.some((s) => s.id === value.subject.id)) list.push(value.subject);
    return list;
  }, [saved, typeById, value]);

  const tipo = typeById.get(tipoIdDeFicha(value) ?? '');
  const campos = camposDe(value);

  const setCampo = (k: 'brand' | 'model' | 'serial', x: string) => {
    if (value.mode === 'saved') onChange({ mode: 'saved', subject: { ...value.subject, [k]: x } });
    else if (value.mode === 'new') onChange({ ...value, [k]: x });
  };
  const setDetalle = (k: string, x: string) => {
    if (value.mode === 'saved') onChange({ mode: 'saved', subject: { ...value.subject, details: { ...value.subject.details, [k]: x } } });
    else if (value.mode === 'new') onChange({ ...value, details: { ...value.details, [k]: x } });
  };

  if (types.length === 0 && value.mode !== 'saved') {
    return (
      <p className="text-sm text-muted-foreground">
        No hay tipos de ficha.{' '}
        <Link href="/service-types" className="underline">Configúralos</Link> si atiendes algo que el cliente
        trae o deja (una mascota, un vehículo).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Qué se atiende" className="space-y-2">
        {allowNone && (
          <Opcion
            name={name} checked={value.mode === 'none'} onSelect={() => onChange({ mode: 'none' })}
            title="Nada" hint="El servicio es a la persona o al lugar"
          />
        )}
        {loading && <p className="text-sm text-muted-foreground">Buscando las fichas del cliente…</p>}
        {error && <p className="text-sm text-destructive">No se pudieron leer las fichas del cliente: {error}</p>}
        {fichas.map((s) => {
          const t = typeById.get(s.equipmentTypeId ?? '');
          return (
            <Opcion
              key={s.id} name={name}
              checked={value.mode === 'saved' && value.subject.id === s.id}
              onSelect={() => onChange({ mode: 'saved', subject: s })}
              title={etiquetaDeFicha(s, t)}
              hint={[t?.name, s.notes ? 'tiene notas' : ''].filter(Boolean).join(' · ') || undefined}
            />
          );
        })}
        {types.length > 0 && (
          <Opcion
            name={name} checked={value.mode === 'new'}
            onSelect={() => { if (value.mode !== 'new') onChange(fichaNueva(types.length === 1 ? types[0].id : '')); }}
            title="Nueva ficha"
            hint={customerId ? 'Queda guardada en el cliente para la próxima vez' : 'Sin cliente, queda solo en esta orden'}
          />
        )}
      </div>

      {value.mode === 'saved' && value.subject.notes && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="whitespace-pre-line">{value.subject.notes}</p>
        </div>
      )}

      {value.mode === 'new' && types.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor={`${name}-tipo`}>Tipo de ficha</Label>
          <select
            id={`${name}-tipo`} className={SELECT_CLASS} value={value.equipmentTypeId}
            onChange={(e) => onChange({ ...value, equipmentTypeId: e.target.value, details: {} })}
          >
            <option value="">Elige el tipo</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {campos && tipo && (fichaFields(tipo).length > 0 || tipo.extraFields.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fichaFields(tipo).map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`${name}-${f.key}`}>{f.label}</Label>
              <Input id={`${name}-${f.key}`} value={campos[f.key] ?? ''} onChange={(e) => setCampo(f.key, e.target.value)} />
            </div>
          ))}
          {tipo.extraFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`${name}-x-${f.key}`}>{f.label}</Label>
              <Input
                id={`${name}-x-${f.key}`}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                value={campos.details[f.key] ?? ''}
                onChange={(e) => setDetalle(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
      {value.mode === 'saved' && tipo && (
        <p className="text-xs text-muted-foreground">Lo que cambies aquí queda en esta orden; la ficha guardada no cambia.</p>
      )}

      {value.mode === 'new' && customerId && (
        <div className="space-y-1.5">
          <Label htmlFor={`${name}-notas`}>Notas de la ficha (opcional)</Label>
          <Input
            id={`${name}-notas`} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })}
            placeholder="«Muerde», «alérgico a…», «llamar antes de ir»"
          />
        </div>
      )}
    </div>
  );
}
