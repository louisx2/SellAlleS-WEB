'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LATE_FEE_MODE_LABEL, lateFeeModeHelp, type LateFeeMode } from '@/lib/late-fee';
import type { PaymentFrequency } from '@/lib/frequency';

// Los cuatro campos de la política de mora, en un solo lugar: los usan los
// ajustes de la empresa (financiamiento y préstamos) y el diálogo de sucursal.
// Tenerlos duplicados era pedir que un formulario validara distinto que otro.
//
// El modo 'inherit' significa "hereda" y solo lo usa la sucursal: ahí los
// cuatro campos vacíos siguen lo que tenga la empresa. Mismo centinela que usa
// el diálogo de sucursal para el interés.
export const INHERIT = 'inherit' as const;

export interface LateFeeFieldsProps {
  /** Prefijo de los `id`/`htmlFor`: tiene que ser único en la página. */
  idPrefix: string;
  rate: string;
  onRateChange: (v: string) => void;
  mode: LateFeeMode | typeof INHERIT;
  onModeChange: (v: LateFeeMode | typeof INHERIT) => void;
  graceDays: string;
  onGraceDaysChange: (v: string) => void;
  maxRate: string;
  onMaxRateChange: (v: string) => void;
  /** Frecuencia con la que se explica 'per_period' ("por cada quincena…"). */
  frequency?: PaymentFrequency;
  /** Etiqueta de la opción "heredar". Sin ella el modo es obligatorio. */
  inheritLabel?: string;
  /** Qué se hereda cuando el campo queda vacío, para los placeholders. */
  inherited?: { rate?: number; graceDays?: number; maxRate?: number };
  disabled?: boolean;
}

export function LateFeeFields({
  idPrefix,
  rate,
  onRateChange,
  mode,
  onModeChange,
  graceDays,
  onGraceDaysChange,
  maxRate,
  onMaxRateChange,
  frequency = 'monthly',
  inheritLabel,
  inherited,
  disabled,
}: LateFeeFieldsProps) {
  const effectiveMode: LateFeeMode = mode === INHERIT ? 'once' : mode;
  const shownRate = Number(rate) || inherited?.rate || 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-mode`}>Cómo se cobra la mora</Label>
        <Select
          value={mode}
          onValueChange={(v) => onModeChange(v as LateFeeMode | typeof INHERIT)}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-mode`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {inheritLabel && <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>}
            <SelectItem value="once">{LATE_FEE_MODE_LABEL.once}</SelectItem>
            <SelectItem value="daily">{LATE_FEE_MODE_LABEL.daily}</SelectItem>
            <SelectItem value="per_period">{LATE_FEE_MODE_LABEL.per_period}</SelectItem>
          </SelectContent>
        </Select>
        {mode !== INHERIT && (
          <p className="text-xs text-muted-foreground">{lateFeeModeHelp(effectiveMode, shownRate, frequency)}</p>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-rate`} className="text-xs">
            {effectiveMode === 'daily' ? 'Mora mensual (%)' : 'Mora por cuota (%)'}
          </Label>
          <Input
            id={`${idPrefix}-rate`}
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={rate}
            onChange={(e) => onRateChange(e.target.value)}
            placeholder={inherited?.rate != null ? `Empresa: ${inherited.rate}%` : undefined}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-grace`} className="text-xs">Días de gracia</Label>
          <Input
            id={`${idPrefix}-grace`}
            type="number"
            min="0"
            max="365"
            step="1"
            value={graceDays}
            onChange={(e) => onGraceDaysChange(e.target.value)}
            placeholder={inherited?.graceDays != null ? `Empresa: ${inherited.graceDays}` : undefined}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-max`} className="text-xs">Tope de mora (%)</Label>
          <Input
            id={`${idPrefix}-max`}
            type="number"
            min="0"
            max="1000"
            step="1"
            value={maxRate}
            onChange={(e) => onMaxRateChange(e.target.value)}
            placeholder={inherited?.maxRate != null ? `Empresa: ${inherited.maxRate || 'sin tope'}` : '0 = sin tope'}
            disabled={disabled}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        La gracia son los días después del vencimiento antes de que la mora empiece a correr.
        El tope es el máximo que puede acumular una cuota, como % de lo vencido — 0 la deja sin
        techo, que en mora diaria no conviene.
      </p>
    </div>
  );
}

/** Lo que devuelve validar el formulario: o un error legible, o los números. */
export type LateFeeFormResult =
  | { ok: true; rate: number; mode: LateFeeMode; graceDays: number; maxRate: number }
  | { ok: false; error: string };

/**
 * Valida los cuatro campos con los mismos límites que `validate_late_fee_params`
 * en la base. Si acá pasa y allá no, el usuario ve un error de Postgres en un
 * toast; por eso son los mismos números.
 */
export function parseLateFeeForm(
  rate: string,
  mode: LateFeeMode,
  graceDays: string,
  maxRate: string,
): LateFeeFormResult {
  const r = Number(rate);
  const g = Number(graceDays);
  const m = Number(maxRate);

  if (!Number.isFinite(r) || r < 0 || r > 100) {
    return { ok: false, error: 'La tasa de mora debe ser un porcentaje entre 0 y 100.' };
  }
  if (!Number.isInteger(g) || g < 0 || g > 365) {
    return { ok: false, error: 'Los días de gracia deben ser un número entero de 0 a 365.' };
  }
  if (!Number.isFinite(m) || m < 0 || m > 1000) {
    return { ok: false, error: 'El tope de mora debe ir de 0 (sin tope) a 1000.' };
  }
  return { ok: true, rate: r, mode, graceDays: g, maxRate: m };
}

/** Resumen de una línea para el toast de guardado. */
export function lateFeeSummary(rate: number, mode: LateFeeMode, graceDays: number, maxRate: number): string {
  const head =
    mode === 'daily'
      ? `Mora ${rate}% mensual por día de atraso`
      : mode === 'per_period'
        ? `Mora ${rate}% por período de atraso`
        : `Mora ${rate}% por cuota vencida`;
  const grace = graceDays > 0 ? ` · ${graceDays} día${graceDays === 1 ? '' : 's'} de gracia` : '';
  const cap = maxRate > 0 ? ` · tope ${maxRate}%` : '';
  return `${head}${grace}${cap}`;
}
