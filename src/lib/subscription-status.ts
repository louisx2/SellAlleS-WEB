// En qué punto está cada empresa con lo que le paga a SellAlleS.
//
// Se cobra por sucursal ACTIVA (ver subscription-pricing.ts): una empresa con
// 3 sucursales en Pro paga 3 veces la tarifa. El pago cubre a la empresa
// entera hasta companies.paid_until; cuando esa fecha pasa, auth-provider la
// deja en solo lectura.

import type { Company } from '@/lib/types';
import {
  companyMonthlyRevenue, planRatePerBranch, type BillingCycle, type PricedPlan, type PricedSub,
} from '@/lib/subscription-pricing';

export type EstadoCobro =
  | 'vencida'        // activa y paid_until ya pasó: está en solo lectura
  | 'sin_registro'   // activa, con tarifa, y nunca se le registró hasta cuándo pagó
  | 'prueba_vencida' // la prueba terminó y no ha pagado
  | 'por_vencer'     // paid_until en los próximos DIAS_AVISO días
  | 'prueba'         // en prueba, todavía dentro del plazo
  | 'al_dia'
  | 'sin_tarifa'     // activa con un plan sin precio (Gratis/Prueba) o sin plan
  | 'suspendida';

/** Días antes del vencimiento en que una empresa pasa a "por vencer". */
export const DIAS_AVISO = 7;

export const ESTADO_COBRO_LABEL: Record<EstadoCobro, string> = {
  vencida: 'Vencida',
  sin_registro: 'Nunca ha pagado',
  prueba_vencida: 'Prueba vencida',
  por_vencer: 'Por vencer',
  prueba: 'En prueba',
  al_dia: 'Al día',
  sin_tarifa: 'Sin tarifa',
  suspendida: 'Suspendida',
};

/** Cómo se agrupan en Cobros, cada grupo con su color. */
export type GrupoCobro = 'atrasados' | 'por_vencer' | 'al_dia' | 'prueba' | 'no_se_cobran';

export const GRUPO_DE_ESTADO: Record<EstadoCobro, GrupoCobro> = {
  vencida: 'atrasados',
  sin_registro: 'atrasados',
  por_vencer: 'por_vencer',
  al_dia: 'al_dia',
  prueba: 'prueba',
  prueba_vencida: 'prueba',
  sin_tarifa: 'no_se_cobran',
  suspendida: 'no_se_cobran',
};

export const GRUPOS_COBRO: { key: GrupoCobro; label: string; descripcion: string }[] = [
  { key: 'atrasados', label: 'Atrasados', descripcion: 'Activas con el pago vencido o que nunca han pagado' },
  { key: 'por_vencer', label: 'Por vencer', descripcion: `Su pago vence en los próximos días` },
  { key: 'al_dia', label: 'Al día', descripcion: 'Pagadas por adelantado' },
  { key: 'prueba', label: 'En prueba', descripcion: 'Todavía no pagan; las de prueba terminada están en solo lectura' },
  { key: 'no_se_cobran', label: 'No se cobran', descripcion: 'Plan sin precio o empresa suspendida' },
];

/** Orden de la lista: primero lo que hay que cobrar. */
export const ESTADO_COBRO_ORDEN: EstadoCobro[] = [
  'vencida', 'sin_registro', 'prueba_vencida', 'por_vencer', 'prueba', 'al_dia', 'sin_tarifa', 'suspendida',
];

/** yyyy-mm-dd de hoy en la hora del equipo, no en UTC: a las 9 de la noche en
 *  RD, en UTC ya es mañana y una empresa que vence hoy saldría vencida. */
export function hoyLocal(): string {
  return fechaLocal(new Date());
}

/** yyyy-mm-dd local de un instante (Date o timestamptz en ISO). */
export function fechaLocal(instante: Date | string): string {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Días de `desde` a `hasta` (yyyy-mm-dd), positivo si `hasta` es posterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00`).getTime();
  const b = new Date(`${hasta}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export interface CobroEmpresa {
  estado: EstadoCobro;
  /** Días que faltan (positivo) o de atraso (negativo) respecto al vencimiento
   *  que aplique: paid_until o el fin de la prueba. null si no hay fecha. */
  dias: number | null;
  sucursalesActivas: number;
  ciclo: BillingCycle;
  /** Tarifa por sucursal en el ciclo (por mes). null = plan sin tarifa por sucursal. */
  tarifaPorSucursal: number | null;
  /** Lo que paga al mes, ya multiplicado por sucursales. */
  mensual: number;
  /** Lo que se le cobra por período: un mes, o doce si paga anual. */
  montoPeriodo: number;
}

export function cobroDeEmpresa(
  company: Company,
  plan: PricedPlan | undefined,
  sub: PricedSub | undefined,
  hoy: string = hoyLocal(),
): CobroEmpresa {
  const sucursalesActivas = (company.branches ?? []).filter((b) => b.is_active).length;
  const ciclo: BillingCycle = sub?.billing_cycle === 'annual' ? 'annual' : 'monthly';
  const tarifaPorSucursal = planRatePerBranch(plan, ciclo);
  const mensual = companyMonthlyRevenue(plan, sub, sucursalesActivas);
  const montoPeriodo = ciclo === 'annual' ? mensual * 12 : mensual;

  const base = { sucursalesActivas, ciclo, tarifaPorSucursal, mensual, montoPeriodo };

  if (company.status === 'suspended') {
    return { ...base, estado: 'suspendida', dias: company.paid_until ? diasEntre(hoy, company.paid_until) : null };
  }

  if (company.status === 'trial') {
    // trial_ends_at es un instante (fin del día local guardado en UTC): se
    // pasa a fecha local, que cortar el ISO lo correría un día.
    const fin = company.trial_ends_at ? fechaLocal(company.trial_ends_at) : null;
    if (!fin) return { ...base, estado: 'prueba', dias: null };
    const dias = diasEntre(hoy, fin);
    return { ...base, estado: dias < 0 ? 'prueba_vencida' : 'prueba', dias };
  }

  // Activa.
  if (company.paid_until) {
    const dias = diasEntre(hoy, company.paid_until);
    if (dias < 0) return { ...base, estado: 'vencida', dias };
    if (mensual <= 0) return { ...base, estado: 'sin_tarifa', dias };
    return { ...base, estado: dias <= DIAS_AVISO ? 'por_vencer' : 'al_dia', dias };
  }
  return { ...base, estado: mensual > 0 ? 'sin_registro' : 'sin_tarifa', dias: null };
}
