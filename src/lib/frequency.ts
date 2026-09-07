import { addDays, addMonths } from 'date-fns';

// Frecuencia de pago de un plan de cuotas. La comparten Financiamiento (ventas
// a cuotas) y Préstamos: son dominios distintos, pero el calendario y las
// etiquetas son los mismos y tenerlos duplicados ya había hecho que
// Financiamiento se quedara solo en mensual.
export type PaymentFrequency = 'weekly' | 'biweekly' | 'monthly';

// Cómo se aplica la tasa de interés al plan:
//  - monthly_prorated: la tasa es MENSUAL y se prorratea a los meses que dura
//    el plan de verdad. 12 cuotas quincenales = 6 meses de interés.
//  - per_installment: cada cuota cobra la tasa, sin importar cada cuánto se
//    pague. 12 cuotas quincenales = 12 veces la tasa.
// En frecuencia mensual los dos dan el mismo número.
export type InterestMode = 'monthly_prorated' | 'per_installment';

export const FREQUENCY_LABEL: Record<PaymentFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

// Para tablas y columnas estrechas.
export const FREQUENCY_SHORT: Record<PaymentFrequency, string> = {
  weekly: 'sem.',
  biweekly: 'quinc.',
  monthly: 'mens.',
};

export const INTEREST_MODE_LABEL: Record<InterestMode, string> = {
  monthly_prorated: 'Tasa mensual (se prorratea)',
  per_installment: 'Tasa por cuota',
};

// Cuotas que caben en un mes. Se usa para prorratear la tasa mensual a la
// duración real del plan — mismo cálculo que el trigger en la base.
export const PER_MONTH: Record<PaymentFrequency, number> = { weekly: 4, biweekly: 2, monthly: 1 };

// Días entre cuotas. Mensual no está aquí porque no cuenta días corridos: cae
// el mismo día del mes siguiente.
const DAYS_PER_PERIOD: Partial<Record<PaymentFrequency, number>> = { weekly: 7, biweekly: 14 };

/** Fecha de la cuota número `k` (1-based) de un plan que arranca en `base`. */
export function addPeriods(base: Date, freq: PaymentFrequency, k: number): Date {
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

/** "Cuota Quincenal", "Cuota Mensual"… */
export function installmentLabel(freq: PaymentFrequency): string {
  return `Cuota ${FREQUENCY_LABEL[freq]}`;
}

/** Etiqueta del campo de la tasa, que cambia con el modo. */
export function rateLabel(mode: InterestMode): string {
  return mode === 'per_installment' ? 'Interés por Cuota (%)' : 'Interés Mensual (%)';
}
