import type { PaymentFrequency } from '@/lib/frequency';

/**
 * La mora, en un solo lugar.
 *
 * Espejo EXACTO de `late_fee_accrued` / `late_fee_due` / `late_fee_policy` en
 * la base (migración `20260916120000_mora_configurable`). Acá solo se MUESTRA;
 * el dinero que se cobra de verdad lo calcula el servidor. Si una cambia, la
 * otra cambia: que el badge diga un número y la RPC cobre otro es el peor bug
 * posible en este módulo.
 */

export type LateFeeMode = 'once' | 'daily' | 'per_period';

export const LATE_FEE_MODES: LateFeeMode[] = ['once', 'daily', 'per_period'];

export const LATE_FEE_MODE_LABEL: Record<LateFeeMode, string> = {
  once: 'Multa fija por cuota vencida',
  daily: 'Mora diaria sobre lo vencido',
  per_period: 'Cargo por período de atraso',
};

/** Lo que hay que explicarle al que configura, con la tasa ya puesta. */
export function lateFeeModeHelp(mode: LateFeeMode, rate: number, freq: PaymentFrequency = 'monthly'): string {
  const r = Number.isFinite(rate) ? rate : 0;
  switch (mode) {
    case 'daily':
      return `${r}% mensual del saldo vencido, prorrateado por día (${round2(r / 30)}% diario). Crece mientras no paga y se detiene el día que abona.`;
    case 'per_period':
      return `${r}% del saldo vencido por cada ${PERIOD_NOUN[freq]} de atraso cumplido. Un día tarde cuesta lo mismo que ${PERIOD_DAYS[freq] - 1} días.`;
    default:
      return `${r}% de la cuota, una sola vez. No crece con el tiempo.`;
  }
}

const PERIOD_NOUN: Record<PaymentFrequency, string> = {
  weekly: 'semana',
  biweekly: 'quincena',
  monthly: 'mes',
};

/**
 * Días de un período de pago. Mensual se aproxima a 30 a propósito: la mora se
 * prorratea, no cae en fecha fija como la cuota. Igual que
 * `late_fee_period_days` en la base.
 */
export const PERIOD_DAYS: Record<PaymentFrequency, number> = { weekly: 7, biweekly: 14, monthly: 30 };

export function lateFeePeriodDays(freq?: PaymentFrequency | null): number {
  return PERIOD_DAYS[freq ?? 'monthly'] ?? 30;
}

/** Política de mora congelada en una venta o préstamo. */
export interface LateFeePolicy {
  rate: number;
  mode: LateFeeMode;
  graceDays: number;
  /** % máximo de mora sobre la base, por cuota. 0 = sin tope. */
  maxRate: number;
  periodDays: number;
}

/** Cuota mirada desde el cálculo de mora: monto, lo abonado y lo que vence. */
export interface LateFeeInstallment {
  amount: number;
  paidAmount: number;
  lateFeePaid: number;
  dueDate: string; // yyyy-mm-dd
}

/**
 * Redondeo a 2 decimales que da lo MISMO que `round(numeric, 2)` en Postgres.
 *
 * El `Math.round(n * 100) / 100` de toda la vida no basta acá: en binario
 * 100.5 se representa como 100.49999999999999 y JS redondea hacia abajo donde
 * la base redondea hacia arriba. Medido sobre 600 casos, eso daba un centavo de
 * diferencia en 23 de ellos — pantalla y cobro discrepando por un chele, que es
 * justo lo que hace que un cajero deje de creerle al sistema. El épsilon es
 * relativo para que siga funcionando en montos grandes, donde el ULP crece.
 */
const round2 = (n: number) => {
  const scaled = n * 100;
  return Math.round(scaled + Math.sign(scaled) * Math.abs(scaled) * 1e-12) / 100;
};

/** Medianoche local de un `yyyy-mm-dd`, sin que la zona horaria lo corra un día. */
function atMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

const MS_PER_DAY = 86_400_000;

/**
 * Días de atraso que YA devengan mora: los de gracia se perdonan, la mora
 * empieza a correr cuando se acaban. 0 o menos = la cuota no está en mora.
 * Es la misma cuenta que `p_today - p_due_date - p_grace_days` en la base.
 */
export function overdueDays(dueDate: string, today: Date, graceDays: number): number {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - atMidnight(dueDate).getTime()) / MS_PER_DAY);
  return diff - (graceDays || 0);
}

/**
 * Mora DEVENGADA por una cuota, antes de descontar lo ya cobrado.
 *
 * `once` cae sobre la cuota pactada porque es una multa por incumplir;
 * `daily` y `per_period` corren sobre el saldo insoluto porque son intereses
 * por el dinero que sigue en la calle — abonar baja la mora que corre.
 */
export function accruedLateFee(inst: LateFeeInstallment, policy: LateFeePolicy, today: Date): number {
  if (!policy.rate || policy.rate <= 0) return 0;

  const days = overdueDays(inst.dueDate, today, policy.graceDays);
  if (days <= 0) return 0;

  let base: number;
  let units: number;

  if (policy.mode === 'once') {
    base = Math.max(inst.amount, 0);
    units = 1;
  } else {
    base = Math.max(inst.amount - inst.paidAmount, 0);
    units =
      policy.mode === 'daily'
        ? days / 30
        : Math.ceil(days / Math.max(policy.periodDays || 30, 1));
  }

  if (base <= 0) return 0;

  let fee = (base * policy.rate) / 100 * units;
  if (policy.maxRate > 0) fee = Math.min(fee, (base * policy.maxRate) / 100);

  return round2(fee);
}

/**
 * Lo que falta cobrar de mora en una cuota. Nunca negativo: si el saldo bajó y
 * el devengado quedó por debajo de lo ya cobrado, no se devuelve nada.
 */
export function lateFeeDue(inst: LateFeeInstallment, policy: LateFeePolicy, today: Date): number {
  return Math.max(round2(accruedLateFee(inst, policy, today) - inst.lateFeePaid), 0);
}

/** Mora exigible de un plan completo: la suma de sus cuotas abiertas. */
export function totalLateFeeDue(
  installments: LateFeeInstallment[],
  policy: LateFeePolicy,
  today: Date,
): number {
  return round2(installments.reduce((acc, i) => acc + lateFeeDue(i, policy, today), 0));
}

/**
 * Cuánto va a subir la mora de aquí a mañana. En mora diaria es el dato que el
 * cajero necesita para decirle al cliente qué le cuesta seguir esperando; en
 * los otros modos casi siempre es 0, así que la UI solo lo muestra en 'daily'.
 */
export function lateFeeGrowthPerDay(
  installments: LateFeeInstallment[],
  policy: LateFeePolicy,
  today: Date,
): number {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const tomorrow = new Date(t.getTime() + MS_PER_DAY);
  return Math.max(round2(totalLateFeeDue(installments, policy, tomorrow) - totalLateFeeDue(installments, policy, t)), 0);
}

/**
 * Política efectiva de un contrato. Lo congelado manda; lo que no traiga cae a
 * los ajustes vigentes de la empresa.
 *
 * La ausencia de `mode` es la marca de un contrato anterior a la mora
 * configurable: se resuelve a `once`, que es exactamente como se le venía
 * cobrando. Mismo criterio que `late_fee_policy` en la base.
 */
export function resolveLateFeePolicy(
  frozen: {
    lateFeeRate?: number | null;
    lateFeeMode?: LateFeeMode | string | null;
    lateFeeGraceDays?: number | null;
    lateFeeMaxRate?: number | null;
  } | null | undefined,
  fallback: { rate: number; graceDays?: number },
  freq?: PaymentFrequency | null,
): LateFeePolicy {
  const mode = frozen?.lateFeeMode;
  return {
    rate: frozen?.lateFeeRate ?? fallback.rate,
    mode: LATE_FEE_MODES.includes(mode as LateFeeMode) ? (mode as LateFeeMode) : 'once',
    graceDays: frozen?.lateFeeGraceDays ?? fallback.graceDays ?? 0,
    maxRate: frozen?.lateFeeMaxRate ?? 0,
    periodDays: lateFeePeriodDays(freq),
  };
}
