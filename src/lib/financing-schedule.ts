import { addDays, format } from 'date-fns';
import { addPeriods, type PaymentFrequency } from '@/lib/frequency';
import type { FinancingInstallment } from '@/lib/types';

// Calendario de un plan de financiamiento: el primer pago elegido al vender y
// el cambio de fechas de las cuotas pendientes. Es la vista previa del
// navegador; la regla que manda es la de la base (`financing_schedule_due_date`
// y `reschedule_financing_installments`), que vuelve a validar todo.

/** 'yyyy-mm-dd' → medianoche local. `new Date('2026-03-10')` sería UTC y en RD caería el día 9. */
export const parseYmd = (s: string): Date => new Date(`${s}T00:00:00`);

export const toYmd = (d: Date): string => format(d, 'yyyy-MM-dd');

const toDmy = (ymd: string) => parseYmd(ymd).toLocaleDateString('es-DO');

/** Hasta cuántos días después de la venta se puede poner el primer pago. Mismo tope que la base. */
export const MAX_FIRST_DUE_DAYS = 90;

/** Rango permitido para el primer pago de una venta hecha el día `saleDay`. */
export function firstDueBounds(saleDay: Date): { min: string; max: string } {
  return { min: toYmd(saleDay), max: toYmd(addDays(saleDay, MAX_FIRST_DUE_DAYS)) };
}

/**
 * Fecha de la cuota `k` (1-based). Sin primer pago elegido son k períodos
 * desde la venta, lo de siempre; con él, esa fecha y k-1 períodos más. Contar
 * desde el ancla y no de cuota en cuota es lo que deja un plan del 31 en el 31.
 */
export function scheduleDueDate(
  saleDay: Date, freq: PaymentFrequency, k: number, firstDue?: Date | null,
): Date {
  return firstDue ? addPeriods(firstDue, freq, k - 1) : addPeriods(saleDay, freq, k);
}

export type RescheduleRow = {
  number: number;
  status: FinancingInstallment['status'];
  before: string; // yyyy-mm-dd
  after: string;  // yyyy-mm-dd
};

/**
 * Cómo quedan las cuotas al mover la `target` a `newDate`. Con
 * `shiftFollowing`, las siguientes sin pagar se cuentan desde la fecha nueva
 * con la frecuencia del plan; las pagadas no se tocan nunca.
 */
export function previewReschedule(
  installments: FinancingInstallment[],
  freq: PaymentFrequency,
  target: number,
  newDate: string,
  shiftFollowing: boolean,
): RescheduleRow[] {
  return [...installments]
    .sort((a, b) => a.number - b.number)
    .map((i) => {
      let after = i.dueDate;
      if (i.number === target) after = newDate;
      else if (newDate && shiftFollowing && i.number > target && i.status !== 'paid') {
        after = toYmd(addPeriods(parseYmd(newDate), freq, i.number - target));
      }
      return { number: i.number, status: i.status, before: i.dueDate, after };
    });
}

/**
 * Por qué la base rechazaría el cambio, o null si está bien. Mismas reglas y
 * en el mismo orden que `reschedule_financing_installments`. `saleDay` en
 * yyyy-mm-dd; las fechas en ese formato se comparan bien como texto.
 */
export function rescheduleError(rows: RescheduleRow[], target: number, saleDay: string): string | null {
  const row = rows.find((r) => r.number === target);
  if (!row) return 'Esa cuota no existe en este financiamiento.';
  if (!row.after) return 'Indica la nueva fecha.';
  if (row.status === 'paid') return `La cuota ${target} ya está pagada: no se puede mover.`;
  if (row.after < saleDay) return `La cuota no puede vencer antes de la venta (${toDmy(saleDay)}).`;
  for (let k = 1; k < rows.length; k++) {
    if (rows[k].after <= rows[k - 1].after) {
      return `Las fechas tienen que quedar en orden: la cuota ${rows[k].number} tiene que vencer después de la cuota ${rows[k - 1].number} (${toDmy(rows[k - 1].after)}).`;
    }
  }
  if (rows.every((r) => r.after === r.before)) return 'Las fechas quedarían iguales: no hay nada que cambiar.';
  return null;
}
