// En qué punto está cada empresa con lo que le paga a SellAlleS.
//
// Es una cuenta corriente: cada sucursal activa genera una cuota por período
// (mes, o año si paga anual), cobrada por adelantado a partir de su fecha de
// inicio, y a lo cargado se le resta todo lo pagado (subscription_payments).
// Lo que falta es lo que debe; los pagos se aplican a las cuotas más viejas.
//
// Cada sucursal se cobra desde que se creó, aunque después se haya movido de
// empresa: Michelle Auto Service nació el 16/7 como sucursal de Pujols Group,
// se separó como empresa el 24/8, y su primer mes es el que empezó el 16/7.
// Si la empresa tuvo prueba, se cobra desde el día siguiente a que terminó.
// La fecha de la empresa solo manda cuando la cuenta es de la empresa entera
// (plan a medida, o sin sucursales activas).
//
// La cuenta la calcula la base (_cuenta_de_suscripcion), una sola vez para
// todos: Cobros, el banner de los administradores, Mi Suscripción, los correos
// y el resumen de la noche leen lo mismo. Aquí solo se traduce ese jsonb.
//
// Atrasarse no bloquea nada solo: pasar una empresa a "solo ventas" lo decide
// el super admin desde Cobros (la cuenta nada más lo sugiere).

import type { BillingCycle } from '@/lib/subscription-pricing';

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
  proximaCuota: string | null;
  /** De sus cuotas vencidas, las que lo pagado no alcanza a cubrir. */
  pendientes: number;
  /** Fecha de su cuota más vieja sin cubrir. */
  debeDesde: string | null;
}

export interface CobroEmpresa {
  estado: EstadoCobro;
  /** Atraso en días (negativo, desde la cuota más vieja sin pagar) o días que
   *  faltan para la próxima cuota que no alcanza a cubrir lo pagado. En prueba,
   *  días para el fin de la prueba. null si no aplica. */
  dias: number | null;
  /** Días de atraso (0 si no debe nada vencido). */
  diasAtraso: number;
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
  /** Suma de los comprobantes que subió la empresa y faltan por confirmar. */
  porConfirmar: number;
  comprobantesPorConfirmar: number;
  soloVentas: boolean;
  soloVentasDesde: string | null;
  /** Lleva los días configurados de atraso, sin comprobantes en revisión y
   *  sin estar ya en solo ventas. Es solo una sugerencia. */
  sugerirSoloVentas: boolean;
  soloVentasSugerirDias: number;
}

const num = (v: unknown, def = 0): number => {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? def : n;
};
const numONull = (v: unknown): number | null => (v == null ? null : num(v));
const texto = (v: unknown): string | null => (v == null ? null : String(v));

/** Traduce el jsonb de _cuenta_de_suscripcion (vía mi_cuenta_de_suscripcion o
 *  cuentas_de_suscripcion). */
export function cuentaDesdeJson(j: any): CobroEmpresa {
  const pp = j?.pagar_pendiente;
  return {
    estado: (j?.estado ?? 'sin_tarifa') as EstadoCobro,
    dias: numONull(j?.dias),
    diasAtraso: num(j?.dias_atraso),
    sucursalesActivas: num(j?.sucursales_activas),
    ciclo: j?.ciclo === 'annual' ? 'annual' : 'monthly',
    tarifaPorSucursal: numONull(j?.tarifa_por_sucursal),
    mensual: num(j?.mensual),
    montoPeriodo: num(j?.monto_periodo),
    cuentas: ((j?.cuentas ?? []) as any[]).map((c) => ({
      branchId: c.branch_id ?? null,
      nombre: String(c.nombre ?? ''),
      desde: String(c.desde ?? ''),
      cuota: num(c.cuota),
      cuotas: num(c.cuotas),
      cargado: num(c.cargado),
      proximaCuota: texto(c.proxima_cuota),
      pendientes: num(c.pendientes),
      debeDesde: texto(c.debe_desde),
    })),
    cargado: num(j?.cargado),
    pagado: num(j?.pagado),
    saldo: num(j?.saldo),
    cuotasPendientes: num(j?.cuotas_pendientes),
    debeDesde: texto(j?.debe_desde),
    proximoCobro: texto(j?.proximo_cobro),
    pagarPendiente: pp ? { monto: num(pp.monto), desde: String(pp.desde), hasta: String(pp.hasta) } : null,
    porConfirmar: num(j?.por_confirmar),
    comprobantesPorConfirmar: num(j?.comprobantes_por_confirmar),
    soloVentas: !!j?.solo_ventas,
    soloVentasDesde: texto(j?.solo_ventas_desde),
    sugerirSoloVentas: !!j?.sugerir_solo_ventas,
    soloVentasSugerirDias: num(j?.solo_ventas_sugerir_dias, 10),
  };
}

/** Lo que toca pagar en la próxima cuota: las cuotas de las sucursales que
 *  vencen ese día (igual que el recordatorio por correo). */
export function montoProximaCuota(c: CobroEmpresa): number {
  const delDia = c.cuentas
    .filter((x) => x.proximaCuota && x.proximaCuota === c.proximoCobro)
    .reduce((acc, x) => acc + x.cuota, 0);
  return delDia > 0 ? delDia : (c.cuentas[0]?.cuota ?? c.montoPeriodo);
}
