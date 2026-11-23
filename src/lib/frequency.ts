import { addDays, addMonths } from 'date-fns';

// Frecuencia de pago de un plan de cuotas. La comparten Financiamiento (ventas
// a cuotas) y Préstamos: son dominios distintos, pero el calendario y las
// etiquetas son los mismos y tenerlos duplicados ya había hecho que
// Financiamiento se quedara solo en mensual.
//
// Las dos diarias llevan el calendario en la frecuencia misma: `daily` se cobra
// de lunes a sábado y `daily_all` todos los días. Así queda congelado en el plan
// sin columnas aparte, y la base las entiende con las mismas funciones.
export type PaymentFrequency = 'daily' | 'daily_all' | 'weekly' | 'biweekly' | 'monthly';

/** Orden en que se ofrecen en los selectores. */
export const FREQUENCY_OPTIONS: PaymentFrequency[] = ['daily', 'daily_all', 'weekly', 'biweekly', 'monthly'];

// Cómo se aplica la tasa de interés al plan:
//  - monthly_prorated: la tasa es MENSUAL y se prorratea a los meses que dura
//    el plan de verdad. 12 cuotas quincenales = 6 meses de interés.
//  - per_installment: cada cuota cobra la tasa, sin importar cada cuánto se
//    pague. 12 cuotas quincenales = 12 veces la tasa.
// En frecuencia mensual los dos dan el mismo número.
export type InterestMode = 'monthly_prorated' | 'per_installment';

export const FREQUENCY_LABEL: Record<PaymentFrequency, string> = {
  daily: 'Diario (lun–sáb)',
  daily_all: 'Diario (todos los días)',
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

// Para tablas y columnas estrechas.
export const FREQUENCY_SHORT: Record<PaymentFrequency, string> = {
  daily: 'diar.',
  daily_all: 'diar.',
  weekly: 'sem.',
  biweekly: 'quinc.',
  monthly: 'mens.',
};

export const INTEREST_MODE_LABEL: Record<InterestMode, string> = {
  monthly_prorated: 'Tasa mensual (se prorratea)',
  per_installment: 'Tasa por cuota',
};

// Cuotas que caben en un mes. Se usa para prorratear la tasa mensual a la
// duración real del plan — mismo cálculo que `financing_months` en la base.
// De lunes a sábado caben 26 cuotas diarias en un mes; todos los días, 30.
export const PER_MONTH: Record<PaymentFrequency, number> = { daily: 26, daily_all: 30, weekly: 4, biweekly: 2, monthly: 1 };

/**
 * Cuotas máximas de un plan: 312 o 5 años, lo que se cumpla primero. Espejo de
 * `max_installments` en la base.
 */
const MAX_INSTALLMENTS: Record<PaymentFrequency, number> = { daily: 312, daily_all: 312, weekly: 240, biweekly: 120, monthly: 60 };

export function maxInstallments(freq: PaymentFrequency): number {
  return MAX_INSTALLMENTS[freq];
}

// Días entre cuotas. Mensual no está aquí porque no cuenta días corridos: cae
// el mismo día del mes siguiente; `daily` tampoco, porque salta los domingos.
const DAYS_PER_PERIOD: Partial<Record<PaymentFrequency, number>> = { daily_all: 1, weekly: 7, biweekly: 14 };

/**
 * `k` días de lunes a sábado después de `base`. El domingo cuenta como si fuera
 * el sábado: el día de cobro siguiente a los dos es el lunes. Mismo algoritmo
 * que la rama `daily` de `financing_due_date` en la base.
 */
function addWorkdays(base: Date, k: number): Date {
  if (k === 0) return base;
  const iso = base.getDay() === 0 ? 7 : base.getDay(); // lun = 1 … dom = 7
  const pos = Math.min(iso - 1, 5) + k; // posición en una semana de 6 días
  const lunes = addDays(base, -(iso - 1));
  return addDays(lunes, Math.floor(pos / 6) * 7 + (pos % 6));
}

/**
 * Desde dónde se cuentan las cuotas de un plan con primer pago elegido. En un
 * plan de lunes a sábado, un domingo elegido pasa al lunes: si no, la cuota 1
 * caería en domingo y la 2 el mismo lunes. Espejo de
 * `financing_schedule_due_date` en la base.
 */
export function firstDueAnchor(freq: PaymentFrequency, firstDue: Date): Date {
  return freq === 'daily' && firstDue.getDay() === 0 ? addDays(firstDue, 1) : firstDue;
}

/** Fecha de la cuota número `k` (1-based) de un plan que arranca en `base`. */
export function addPeriods(base: Date, freq: PaymentFrequency, k: number): Date {
  if (freq === 'daily') return addWorkdays(base, k);
  const days = DAYS_PER_PERIOD[freq];
  return days ? addDays(base, k * days) : addMonths(base, k);
}

/**
 * Meses de interés que cobra un plan de `n` cuotas. Tiene que dar EXACTAMENTE
 * lo mismo que el `case` de `before_sale_credit_checks` en la base: acá es solo
 * la vista previa del POS, el monto que queda grabado lo calcula el servidor.
 */
export function monthsFor(freq: PaymentFrequency, n: number, mode: InterestMode): number {
  if (mode === 'per_installment') return n;
  return n / PER_MONTH[freq];
}

/** "Cuota Quincenal", "Cuota Mensual", "Cuota Diaria"… */
export function installmentLabel(freq: PaymentFrequency): string {
  if (freq === 'daily' || freq === 'daily_all') return 'Cuota Diaria';
  return `Cuota ${FREQUENCY_LABEL[freq]}`;
}

/** Etiqueta del campo de la tasa, que cambia con el modo. */
export function rateLabel(mode: InterestMode): string {
  return mode === 'per_installment' ? 'Interés por Cuota (%)' : 'Interés Mensual (%)';
}
