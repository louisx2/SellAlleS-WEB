// En qué punto está cada empresa con lo que le paga a SellAlleS.
//
// Es una cuenta corriente: cada sucursal activa genera una cuota por período
// (mes, o año si paga anual), cobrada por adelantado a partir de su fecha de
// inicio, y a lo cargado se le resta todo lo pagado (subscription_payments).
// Lo que falta es lo que debe; los pagos se aplican a las cuotas más viejas.
//
// La fecha de inicio de una sucursal es la más reciente entre la creación de
// la empresa y la de la sucursal: una sucursal que se agrega después empieza a
// pagar desde que se agregó, y una que se pasó de otra empresa (Michelle Auto
// Service salió de Pujols) empieza con la empresa nueva. Si la empresa tuvo
// prueba, se cobra desde el día siguiente a que terminó.
//
// La tarifa es la de hoy del plan (ver subscription-pricing.ts) y cuentan las
// sucursales activas hoy: no hay historial de precios ni de desactivaciones.
//
// Ojo: el bloqueo de solo lectura (auth-provider) sigue mirando
// companies.paid_until, que se mueve al registrar un pago con período.

import type { Company } from '@/lib/types';
import {
  companyMonthlyRevenue, planRatePerBranch, type BillingCycle, type PricedPlan, type PricedSub,
} from '@/lib/subscription-pricing';

export type EstadoCobro =
  | 'atrasada'       // ya pagó alguna vez, pero debe cuotas vencidas
  | 'nunca_pago'     // debe cuotas y no tiene ni un pago registrado
  | 'prueba_vencida' // la prueba terminó y no se activó
  | 'por_vencer'     // lo pagado alcanza, pero la próxima cuota llega en DIAS_AVISO días o menos
  | 'prueba'         // en prueba, dentro del plazo
  | 'al_dia'
  | 'sin_tarifa'     // activa con un plan sin precio (Gratis/Prueba) o sin plan
  | 'suspendida';

/** Días antes de la próxima cuota en que una empresa pasa a "por vencer". */
export const DIAS_AVISO = 7;

export const ESTADO_COBRO_LABEL: Record<EstadoCobro, string> = {
  atrasada: 'Atrasada',
  nunca_pago: 'Nunca ha pagado',
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
  atrasada: 'atrasados',
  nunca_pago: 'atrasados',
  por_vencer: 'por_vencer',
  al_dia: 'al_dia',
  prueba: 'prueba',
  prueba_vencida: 'prueba',
  sin_tarifa: 'no_se_cobran',
  suspendida: 'no_se_cobran',
};

export const GRUPOS_COBRO: { key: GrupoCobro; label: string; descripcion: string }[] = [
  { key: 'atrasados', label: 'Atrasados', descripcion: 'Deben cuotas ya vencidas' },
  { key: 'por_vencer', label: 'Por vencer', descripcion: 'Están pagadas, pero la próxima cuota llega en pocos días' },
  { key: 'al_dia', label: 'Al día', descripcion: 'No deben nada' },
  { key: 'prueba', label: 'En prueba', descripcion: 'Todavía no pagan; las de prueba terminada están en solo lectura' },
  { key: 'no_se_cobran', label: 'No se cobran', descripcion: 'Plan sin precio o empresa suspendida' },
];

/** Orden de la lista: primero lo que hay que cobrar. */
export const ESTADO_COBRO_ORDEN: EstadoCobro[] = [
  'nunca_pago', 'atrasada', 'prueba_vencida', 'por_vencer', 'prueba', 'al_dia', 'sin_tarifa', 'suspendida',
];

// ── Fechas (yyyy-mm-dd en hora local) ──────────────────────────────────────

const dos = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd de hoy en la hora del equipo, no en UTC: a las 9 de la noche en
 *  RD, en UTC ya es mañana y una cuota que vence mañana saldría vencida. */
export function hoyLocal(): string {
  return fechaLocal(new Date());
}

/** yyyy-mm-dd local de un instante (Date o timestamptz en ISO). */
export function fechaLocal(instante: Date | string): string {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Días de `desde` a `hasta`, positivo si `hasta` es posterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00`).getTime();
  const b = new Date(`${hasta}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function sumarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return fechaLocal(d);
}

/** Suma meses sin desbordar: el 31/1 más un mes es el 28/2 (o 29), no el 3/3.
 *  Se calcula siempre desde la fecha de inicio para que no se vaya corriendo. */
export function sumarMeses(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const ultimo = new Date(ny, nm + 1, 0).getDate();
  return `${ny}-${dos(nm + 1)}-${dos(Math.min(d, ultimo))}`;
}

const mayor = (a: string, b: string) => (a > b ? a : b);

// ── Cuenta ─────────────────────────────────────────────────────────────────

export interface CuentaSucursal {
  /** null = una cuenta de toda la empresa (plan a medida, o sin sucursales). */
  branchId: string | null;
  nombre: string;
  /** Desde cuándo se le cobra: la fecha de su primera cuota. */
  desde: string;
  /** Monto de cada cuota (un mes, o doce si paga anual). */
  cuota: number;
  /** Cuotas que ya llegaron, contando la del período en curso. */
  cuotas: number;
  cargado: number;
  /** Fecha de la próxima cuota que todavía no llega. */
  proximaCuota: string;
}

export interface CobroEmpresa {
  estado: EstadoCobro;
  /** Atraso en días (negativo, desde la cuota más vieja sin pagar) o días que
   *  faltan para la próxima cuota que no alcanza a cubrir lo pagado. En prueba,
   *  días para el fin de la prueba. null si no aplica. */
  dias: number | null;
  sucursalesActivas: number;
  ciclo: BillingCycle;
  /** Tarifa por sucursal, por mes. null = plan sin tarifa por sucursal. */
  tarifaPorSucursal: number | null;
  /** Lo que paga al mes, ya multiplicado por sucursales. */
  mensual: number;
  /** Lo que se le cobra por período: un mes, o doce si paga anual. */
  montoPeriodo: number;
  cuentas: CuentaSucursal[];
  cargado: number;
  pagado: number;
  /** cargado − pagado: positivo = debe; negativo = saldo a favor. */
  saldo: number;
  /** Cuotas vencidas que lo pagado no cubre (una a medio pagar cuenta). */
  cuotasPendientes: number;
  /** Fecha de la cuota más vieja sin cubrir. */
  debeDesde: string | null;
  /** Fecha de la próxima cuota que lo pagado ya no cubre. */
  proximoCobro: string | null;
  /** Para "pagar lo pendiente": el monto y el período que deja cubierto. */
  pagarPendiente: { monto: number; desde: string; hasta: string } | null;
}

interface Cargo { fecha: string; monto: number; nombre: string }

export function cobroDeEmpresa(
  company: Company,
  plan: PricedPlan | undefined,
  sub: PricedSub | undefined,
  pagado: number,
  hoy: string = hoyLocal(),
): CobroEmpresa {
  const activas = (company.branches ?? []).filter((b) => b.is_active);
  const sucursalesActivas = activas.length;
  const ciclo: BillingCycle = sub?.billing_cycle === 'annual' ? 'annual' : 'monthly';
  const meses = ciclo === 'annual' ? 12 : 1;
  const tarifaPorSucursal = planRatePerBranch(plan, ciclo);
  const mensual = companyMonthlyRevenue(plan, sub, sucursalesActivas);
  const montoPeriodo = mensual * meses;

  const base: CobroEmpresa = {
    estado: 'al_dia', dias: null, sucursalesActivas, ciclo, tarifaPorSucursal, mensual, montoPeriodo,
    cuentas: [], cargado: 0, pagado, saldo: -pagado, cuotasPendientes: 0,
    debeDesde: null, proximoCobro: null, pagarPendiente: null,
  };

  if (company.status === 'suspended') return { ...base, estado: 'suspendida' };

  if (company.status === 'trial') {
    // trial_ends_at es un instante (fin del día local guardado en UTC): se
    // pasa a fecha local, que cortar el ISO lo correría un día.
    const fin = company.trial_ends_at ? fechaLocal(company.trial_ends_at) : null;
    if (!fin) return { ...base, estado: 'prueba' };
    const dias = diasEntre(hoy, fin);
    return { ...base, estado: dias < 0 ? 'prueba_vencida' : 'prueba', dias };
  }

  if (mensual <= 0) return { ...base, estado: 'sin_tarifa' };

  // ── Cuotas ──
  let inicioEmpresa = fechaLocal(company.created_at);
  if (company.trial_ends_at) inicioEmpresa = mayor(inicioEmpresa, sumarDias(fechaLocal(company.trial_ends_at), 1));

  const definiciones: { branchId: string | null; nombre: string; desde: string; cuota: number }[] =
    tarifaPorSucursal != null && activas.length > 0
      ? activas.map((b) => ({
          branchId: b.id,
          nombre: b.name,
          desde: mayor(inicioEmpresa, b.created_at ? fechaLocal(b.created_at) : inicioEmpresa),
          cuota: tarifaPorSucursal * meses,
        }))
      : [{ branchId: null, nombre: 'Toda la empresa', desde: inicioEmpresa, cuota: montoPeriodo }];

  const vencidos: Cargo[] = [];
  const cuentas: CuentaSucursal[] = definiciones.map((d) => {
    let k = 0;
    while (sumarMeses(d.desde, k * meses) <= hoy) {
      vencidos.push({ fecha: sumarMeses(d.desde, k * meses), monto: d.cuota, nombre: d.nombre });
      k += 1;
    }
    return { ...d, cuotas: k, cargado: k * d.cuota, proximaCuota: sumarMeses(d.desde, k * meses) };
  });

  const cargado = cuentas.reduce((acc, c) => acc + c.cargado, 0);
  const saldo = Math.round((cargado - pagado) * 100) / 100;
  const resumen = { ...base, cuentas, cargado, saldo };

  // Lo pagado se aplica a las cuotas más viejas primero.
  vencidos.sort((a, b) => (a.fecha === b.fecha ? a.nombre.localeCompare(b.nombre) : a.fecha < b.fecha ? -1 : 1));
  let resto = pagado;
  let primeraSinCubrir = -1;
  for (let i = 0; i < vencidos.length; i++) {
    if (resto + 0.005 >= vencidos[i].monto) { resto -= vencidos[i].monto; continue; }
    primeraSinCubrir = i;
    break;
  }

  if (primeraSinCubrir >= 0) {
    const debeDesde = vencidos[primeraSinCubrir].fecha;
    // Pagando todo lo pendiente queda cubierto hasta la próxima cuota de
    // cualquiera de sus sucursales.
    const hasta = cuentas.map((c) => c.proximaCuota).sort()[0];
    return {
      ...resumen,
      estado: pagado > 0 ? 'atrasada' : 'nunca_pago',
      dias: -diasEntre(debeDesde, hoy),
      cuotasPendientes: vencidos.length - primeraSinCubrir,
      debeDesde,
      proximoCobro: debeDesde,
      pagarPendiente: { monto: saldo, desde: debeDesde, hasta },
    };
  }

  // Al día: ¿hasta cuándo alcanza lo que sobró? Se siguen aplicando las
  // cuotas que vienen, en orden, hasta la primera que no cubre.
  const siguientes = cuentas.map((c) => ({ ...c, k: c.cuotas }));
  let proximoCobro = siguientes.map((c) => c.proximaCuota).sort()[0];
  for (let vueltas = 0; vueltas < 1000; vueltas++) {
    siguientes.sort((a, b) => (sumarMeses(a.desde, a.k * meses) < sumarMeses(b.desde, b.k * meses) ? -1 : 1));
    const c = siguientes[0];
    const fecha = sumarMeses(c.desde, c.k * meses);
    if (resto + 0.005 < c.cuota) { proximoCobro = fecha; break; }
    resto -= c.cuota;
    c.k += 1;
  }
  const dias = diasEntre(hoy, proximoCobro);
  return { ...resumen, estado: dias <= DIAS_AVISO ? 'por_vencer' : 'al_dia', dias, proximoCobro };
}
