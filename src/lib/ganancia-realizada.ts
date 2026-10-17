import type { Sale } from '@/lib/types';

// Ganancia de la mercancía según se cobra (método de ventas a plazos).
//
// Una venta a crédito o financiada no deja ganancia el día que se hace: el
// cliente se lleva el artículo y lo va pagando. Cada abono reconoce la parte
// de la venta que cubre, en la fecha en que entró el dinero; la venta deja su
// margen completo solo cuando se termina de pagar. Las de contado (efectivo,
// tarjeta, transferencia) se reconocen enteras el día de la venta.
//
// El interés y la mora de un financiamiento no son mercancía: se descuentan de
// cada abono aquí y se reportan aparte, en /reports/financiamientos.
//
// Sin imports de valor a propósito: así se puede probar con node a secas.

/** Lo que hace falta de un abono de credit_payments. Solo abonos vigentes. */
export type AbonoCobrado = {
  saleId?: string;
  kind: string;
  amount: number;
  lateFeePaid: number;
  /** Reparto que guardó la base: cuánto capital y cuánta mora fue a cada venta. */
  allocation?: { sales?: { sale_id: string; principal: number; late_fee?: number }[] } | null;
  date: Date;
};

/** Lo que un abono le dio a una venta: capital (sin mora) y mora. */
export type ParteDeAbono = { saleId: string; capital: number; mora: number; inicial: boolean };

/** Parte de una venta que se cobró en `date`, como fracción de su total. */
export type Realizacion = { sale: Sale; date: Date; fraction: number };

export const ABONO_COBRADO_SELECT = 'id, sale_id, kind, amount, late_fee_paid, allocation, date';

export const rowToAbonoCobrado = (r: any): AbonoCobrado => ({
  saleId: r.sale_id ?? undefined,
  kind: r.kind ?? (r.sale_id ? 'sale' : 'customer'),
  amount: Number(r.amount),
  lateFeePaid: Number(r.late_fee_paid ?? 0),
  allocation: r.allocation ?? null,
  date: new Date(r.date),
});

/**
 * Reparte un abono entre las ventas que cubrió: por el reparto que guardó la
 * base (abono general) o entero a su venta. En un financiamiento, `capital`
 * trae el interés de la cuota adentro; el inicial (`inicial`) no lleva interés.
 */
export function repartoDeAbono(a: AbonoCobrado): ParteDeAbono[] {
  const inicial = a.kind === 'down_payment';
  const reparto = a.allocation?.sales;
  if (reparto && reparto.length > 0) {
    return reparto.map((r) => ({
      saleId: r.sale_id,
      capital: Number(r.principal) || 0,
      mora: Number(r.late_fee) || 0,
      inicial,
    }));
  }
  if (a.saleId) return [{ saleId: a.saleId, capital: a.amount - a.lateFeePaid, mora: a.lateFeePaid, inicial }];
  // Un abono general sin reparto guardado (los de antes del 2026-08-31) no
  // dice a qué venta fue.
  return [];
}

export const esVentaAPlazo = (s: Sale) =>
  s.paymentMethod === 'credit' || s.paymentMethod === 'financing' ||
  s.paymentStatus === 'credit' || s.paymentStatus === 'in_financing';

// Qué parte de lo abonado a un financiamiento es interés. El inicial no lleva
// interés; el plan (todo lo demás, cuotas y refinanciaciones) lo lleva
// repartido parejo. `amountPaid` de un financiamiento cuenta capital + interés.
function interesDelPlan(sale: Sale) {
  const fd = sale.financingDetails;
  if (sale.paymentMethod !== 'financing' || !fd) return { inicial: 0, parteInteres: 0 };
  const inicial = fd.downPayment ?? 0;
  const interes = Math.max(fd.totalWithInterest - sale.total, 0);
  const plan = fd.totalWithInterest - inicial;
  return { inicial, parteInteres: plan > 0 ? interes / plan : 0 };
}

// Mercancía cobrada a hoy, según el saldo que lleva la base.
function mercanciaCobrada(sale: Sale) {
  const { inicial, parteInteres } = interesDelPlan(sale);
  const pagado = Math.max(sale.amountPaid, 0);
  const delInicial = Math.min(pagado, inicial);
  return Math.min(delInicial + (pagado - delInicial) * (1 - parteInteres), sale.total);
}

/** Fracción del total de la venta ya cobrada, a hoy (1 en las de contado). */
export function fraccionCobrada(sale: Sale) {
  if (!esVentaAPlazo(sale) || sale.total <= 0) return 1;
  return mercanciaCobrada(sale) / sale.total;
}

/**
 * Reparte cada venta en los pedazos que ya se cobraron, con su fecha. Las de
 * contado salen en un solo pedazo de fracción 1. Una venta a plazos sin cobrar
 * no sale. `abonos` son todos los vigentes de la empresa: cada uno se cruza
 * con su venta por `sale_id` o por el reparto de un abono general.
 */
export function realizaciones(sales: Sale[], abonos: AbonoCobrado[]): Realizacion[] {
  // Capital (sin mora) que recibió cada venta, abono por abono.
  const porVenta = new Map<string, { date: Date; capital: number; inicial: boolean }[]>();
  const anotar = (saleId: string, date: Date, capital: number, inicial: boolean) => {
    if (!(capital > 0)) return;
    const lista = porVenta.get(saleId) ?? [];
    lista.push({ date, capital, inicial });
    porVenta.set(saleId, lista);
  };
  // Lo que cubrió un abono general sin reparto guardado entra abajo como
  // cobrado sin fecha.
  for (const a of abonos) {
    for (const p of repartoDeAbono(a)) anotar(p.saleId, a.date, p.capital, p.inicial);
  }

  const out: Realizacion[] = [];
  for (const sale of sales) {
    if (!esVentaAPlazo(sale) || sale.total <= 0) {
      out.push({ sale, date: sale.createdAt, fraction: 1 });
      continue;
    }
    const { parteInteres } = interesDelPlan(sale);
    const pedazos = (porVenta.get(sale.id) ?? []).map((p) => ({
      date: p.date,
      mercancia: p.inicial ? p.capital : p.capital * (1 - parteInteres),
    }));
    // Lo que la base da por cobrado sin un abono con fecha que lo respalde —
    // iniciales de antes de que se guardaran como abono, ventas del legado —
    // se reconoce el día de la venta, que es cuando entró casi siempre.
    const conFecha = pedazos.reduce((a, p) => a + p.mercancia, 0);
    const sinFecha = mercanciaCobrada(sale) - conFecha;
    if (sinFecha > 0.01) pedazos.push({ date: sale.createdAt, mercancia: sinFecha });
    pedazos.sort((a, b) => a.date.getTime() - b.date.getTime());

    let acumulado = 0;
    for (const p of pedazos) {
      const mercancia = Math.min(p.mercancia, sale.total - acumulado);
      if (mercancia <= 0) break;
      acumulado += mercancia;
      out.push({ sale, date: p.date, fraction: mercancia / sale.total });
    }
  }
  return out;
}
