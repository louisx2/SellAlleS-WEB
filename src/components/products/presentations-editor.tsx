'use client';

import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getUnit, unitAllowsDecimals, type UnitCode } from '@/lib/units';
import { formatCurrency } from '@/lib/utils';
import type { PresentationDraft } from '@/lib/presentations';

export interface PresentationsEditorProps {
  /** Unidad base del producto: en ella se cuenta el stock y de ella depende si "Contiene" admite fracciones. */
  unit: UnitCode;
  /** Costo por unidad base; NaN o 0 = se desconoce y no se calcula el margen. */
  cost: number;
  drafts: PresentationDraft[];
  onChange: (drafts: PresentationDraft[]) => void;
  soldLoose: boolean;
  onSoldLooseChange: (value: boolean) => void;
  /** Códigos que ya usan otros en la sucursal: clave en minúscula y recortada → nombre del dueño. */
  takenCodes: Map<string, string>;
}

const EMPTY_DRAFT: PresentationDraft = { name: '', units: '', price: '', code: '' };

// Vacío se queda vacío: Number('') es 0 y un 0 escrito por el sistema parecería un dato.
const toNumberOrEmpty = (raw: string): number | '' => {
  if (raw.trim() === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : '';
};

// "RD$X por libra · margen N%", contra el costo de la presentación completa
// (costo por unidad × unidades que trae). Sin unidades o sin precio válidos no hay nada que decir.
function priceHint(d: PresentationDraft, cost: number, unitSingular: string) {
  const { units, price } = d;
  if (units === '' || price === '' || !(units > 1) || !Number.isFinite(price) || price < 0) return null;
  const perUnit = `${formatCurrency(price / units)} por ${unitSingular}`;
  if (!(cost > 0) || !(price > 0)) return { perUnit, margin: null as number | null };
  return { perUnit, margin: ((price - cost * units) / price) * 100 };
}

export function PresentationsEditor({
  unit,
  cost,
  drafts,
  onChange,
  soldLoose,
  onSoldLooseChange,
  takenCodes,
}: PresentationsEditorProps) {
  const baseId = useId();
  const u = getUnit(unit);
  const decimals = unitAllowsDecimals(unit);

  const update = (index: number, patch: Partial<PresentationDraft>) =>
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const remove = (index: number) => onChange(drafts.filter((_, i) => i !== index));
  const add = () => onChange([...drafts, { ...EMPTY_DRAFT }]);

  // Aviso en línea del código de una fila: lo usa otro producto/presentación de la
  // sucursal, o ya lo trae una fila anterior de este mismo producto.
  const codeWarning = (index: number): string | null => {
    const code = drafts[index].code.trim();
    if (code === '') return null;
    const key = code.toLowerCase();
    const owner = takenCodes.get(key);
    if (owner !== undefined) return `El código «${code}» ya lo usa «${owner}» en esta sucursal.`;
    if (drafts.slice(0, index).some((d) => d.code.trim().toLowerCase() === key)) {
      return `El código «${code}» está repetido en otra presentación de este producto.`;
    }
    return null;
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Presentaciones</p>
        <p className="text-xs text-muted-foreground">
          Opcional. Vende también por paquete, caja o saco; el inventario se sigue contando en {u.plural}.
        </p>
      </div>

      {drafts.map((d, i) => {
        const hint = priceHint(d, cost, u.singular);
        const warning = codeWarning(i);
        const id = `${baseId}-${i}`;
        return (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`${id}-name`} className="text-xs">Nombre</Label>
                <Input
                  id={`${id}-name`}
                  value={d.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Paquete, Caja, Saco…"
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={`Quitar ${d.name.trim() || 'presentación'}`}
                onClick={() => remove(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-units`} className="text-xs">Contiene ({u.short})</Label>
                <Input
                  id={`${id}-units`}
                  type="number"
                  inputMode={decimals ? 'decimal' : 'numeric'}
                  // "any": la validación nativa del formulario no explica nada; `validateDrafts` sí.
                  step="any"
                  value={d.units}
                  onChange={(e) => update(i, { units: toNumberOrEmpty(e.target.value) })}
                  placeholder="12"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-price`} className="text-xs">Precio</Label>
                <Input
                  id={`${id}-price`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={d.price}
                  onChange={(e) => update(i, { price: toNumberOrEmpty(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                <Label htmlFor={`${id}-code`} className="text-xs">Código (opcional)</Label>
                <Input
                  id={`${id}-code`}
                  value={d.code}
                  onChange={(e) => update(i, { code: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>

            {hint && (
              <p className="text-xs text-muted-foreground">
                {hint.perUnit}
                {hint.margin !== null && (
                  <>
                    {' · '}
                    <span className={hint.margin < 0 ? 'text-destructive' : undefined}>
                      margen {hint.margin.toFixed(1)}%
                    </span>
                  </>
                )}
              </p>
            )}
            {warning && <p className="text-xs text-destructive">{warning}</p>}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1.5 h-4 w-4" />
        Agregar presentación
      </Button>

      {drafts.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor={`${baseId}-loose`} className="text-sm font-medium">Se vende suelto</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Apágalo si solo se vende por presentación (por ejemplo, una caja cerrada): en el POS
              no se podrá vender por {u.singular}.
            </p>
          </div>
          <Switch id={`${baseId}-loose`} checked={soldLoose} onCheckedChange={onSoldLooseChange} />
        </div>
      )}
    </div>
  );
}
