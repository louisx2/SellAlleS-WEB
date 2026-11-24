// Motopréstamos 3A: la ruta del día del cobrador y su resumen de efectivo.
// Lógica pura (sin Supabase): el hook arma las cuentas y esto decide a quién
// visitar, en qué orden y cuánto sugerir. Pruebas: scripts/tests/cobranza.test.mjs
//
// Las fechas son yyyy-mm-dd en la hora local (el hook las pasa por `fechaLocal`).

export type ResultadoVisita = 'pago' | 'no_estaba' | 'no_tenia' | 'promesa' | 'se_nego' | 'moto_no_aparece';

export const TEXTO_RESULTADO: Record<ResultadoVisita, string> = {
  pago: 'Pagó',
  no_estaba: 'No estaba',
  no_tenia: 'No tenía',
  promesa: 'Prometió pagar',
  se_nego: 'Se negó',
  moto_no_aparece: 'La moto no aparece',
};

/** Un préstamo o una venta a plazos con algo pendiente. `cuota` es lo que toca
 *  cobrar ahora (lo vencido más la de hoy); `mora`, la mora pendiente. */
export type CuentaDeCobro = {
  tipo: 'prestamo' | 'venta';
  id: string;
  customerId: string;
  branchId: string;
  pendiente: number;
  cuota: number;
  mora: number;
  diasAtraso: number;
  venceHoy: boolean;
  proximaFecha?: string;
};

export type Promesa = { customerId: string; fecha: string; monto?: number };

export type MotivoDeVisita = 'atrasado' | 'vence_hoy' | 'promesa';

export type ParadaDeRuta = {
  customerId: string;
  nombre?: string;
  cuentas: CuentaDeCobro[];
  sugerido: number;
  diasAtraso: number;
  motivo: MotivoDeVisita;
  promesa?: Promesa;
  orden: number;
};

const centavos = (n: number) => Math.round(n * 100) / 100;

const diasEntre = (desde: string, hasta: string) =>
  Math.round((new Date(`${hasta}T00:00:00`).getTime() - new Date(`${desde}T00:00:00`).getTime()) / 86_400_000);

export type CuotaDeCobro = { dueDate: string; amount: number; paidAmount: number; status: 'pending' | 'partial' | 'paid' };

/**
 * Arma la cuenta de la ruta desde las cuotas del plan. `pendiente` y `mora` los
 * da el cálculo de siempre (calculateLoanStatus / calculateFinancingStatus).
 * La cuota es lo que falta de las vencidas más la de hoy; si no hay nada
 * vencido, lo que falta de la próxima. Sin plan (crédito simple), todo lo
 * pendiente y sin atraso: solo entra a la ruta por una promesa.
 */
export function cuentaDesdeCuotas(
  c: Omit<CuentaDeCobro, 'cuota' | 'diasAtraso' | 'venceHoy' | 'proximaFecha'> & { cuotas: CuotaDeCobro[] },
  hoy: string,
): CuentaDeCobro {
  const { cuotas, ...cuenta } = c;
  const abiertas = cuotas
    .filter((q) => q.status !== 'paid' && q.amount - q.paidAmount > 0.005)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const falta = (q: CuotaDeCobro) => q.amount - q.paidAmount;
  const tocan = abiertas.filter((q) => q.dueDate <= hoy);
  const vencida = abiertas.find((q) => q.dueDate < hoy);
  const cuota = cuotas.length === 0
    ? cuenta.pendiente
    : tocan.length > 0 ? tocan.reduce((s, q) => s + falta(q), 0) : abiertas[0] ? falta(abiertas[0]) : 0;
  return {
    ...cuenta,
    cuota: centavos(cuota),
    diasAtraso: vencida ? diasEntre(vencida.dueDate, hoy) : 0,
    venceHoy: abiertas.some((q) => q.dueDate === hoy),
    proximaFecha: abiertas.find((q) => q.dueDate > hoy)?.dueDate,
  };
}

/** Lo que se le sugiere cobrar a una cuenta: la cuota más la mora, sin pasarse de lo pendiente. */
const sugeridoDe = (c: CuentaDeCobro) => Math.min(c.pendiente, c.cuota + c.mora);

const toca = (c: CuentaDeCobro) => c.diasAtraso > 0 || c.venceHoy;

/**
 * Las paradas del día: los clientes de la cartera con algo atrasado, algo que
 * vence hoy o una promesa para hoy (y algo pendiente). Por `orden` sigue el
 * orden de la cartera y, a igual orden, el nombre; por `atraso`, el que más
 * días lleva primero.
 */
export function rutaDelDia(
  cuentas: CuentaDeCobro[],
  asignados: { customerId: string; orden: number; nombre?: string }[],
  promesas: Promesa[],
  hoy: string,
  ordenarPor: 'orden' | 'atraso',
): ParadaDeRuta[] {
  const paradas: ParadaDeRuta[] = [];
  for (const a of asignados) {
    const suyas = cuentas.filter((c) => c.customerId === a.customerId && c.pendiente > 0.005);
    if (suyas.length === 0) continue;
    const promesa = promesas.find((p) => p.customerId === a.customerId && p.fecha === hoy);
    const tocan = suyas.filter(toca);
    if (tocan.length === 0 && !promesa) continue;

    const diasAtraso = Math.max(0, ...suyas.map((c) => c.diasAtraso));
    const motivo: MotivoDeVisita = diasAtraso > 0 ? 'atrasado' : tocan.length > 0 ? 'vence_hoy' : 'promesa';
    const sugerido = tocan.length > 0
      ? tocan.reduce((s, c) => s + sugeridoDe(c), 0)
      : promesa?.monto ?? suyas.reduce((s, c) => s + sugeridoDe(c), 0);

    paradas.push({
      customerId: a.customerId,
      nombre: a.nombre,
      cuentas: suyas,
      sugerido: centavos(sugerido),
      diasAtraso,
      motivo,
      promesa,
      orden: a.orden,
    });
  }

  const porNombre = (x: ParadaDeRuta, y: ParadaDeRuta) =>
    (x.nombre ?? '').localeCompare(y.nombre ?? '', 'es') || x.customerId.localeCompare(y.customerId);
  return paradas.sort((x, y) =>
    ordenarPor === 'atraso'
      ? y.diasAtraso - x.diasAtraso || x.orden - y.orden || porNombre(x, y)
      : x.orden - y.orden || porNombre(x, y));
}

export type AbonoDelCobrador = {
  monto: number;
  metodo: 'cash' | 'transfer';
  enCalle: boolean;
  entregado: boolean;
  anulado: boolean;
  fecha: string;
};

/** Lo cobrado hoy (todo método, sin anulados) y el efectivo en mano: cobrado en
 *  la calle, sin entregar y sin anular, con la fecha del más viejo. */
export function resumenDelCobrador(abonos: AbonoDelCobrador[], hoy: string) {
  const vivos = abonos.filter((a) => !a.anulado);
  const enMano = vivos.filter((a) => a.metodo === 'cash' && a.enCalle && !a.entregado);
  return {
    cobradoHoy: centavos(vivos.filter((a) => a.fecha === hoy).reduce((s, a) => s + a.monto, 0)),
    enMano: centavos(enMano.reduce((s, a) => s + a.monto, 0)),
    enManoDesde: enMano.length ? enMano.map((a) => a.fecha).sort()[0] : undefined,
  };
}
