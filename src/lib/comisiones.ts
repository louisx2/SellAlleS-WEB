// Comisiones por vendedor.
//
// La base congela en cada venta quién vendió (seller_id) y su % de ese día
// (commission_rate). Aquí solo se hace la cuenta: la comisión es ese % sobre lo
// vendido sin ITBIS. El total de una venta financiada no lleva el interés, así
// que el interés no comisiona. Las anuladas no comisionan.

export type VentaComisionable = {
  total: number;
  itbisAmount: number;
  commissionRate?: number | null;
  cancelledAt?: Date | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo que se comisiona de una venta: el total menos el ITBIS. */
export function baseComisionable(v: VentaComisionable): number {
  return round2(v.total - v.itbisAmount);
}

/** Comisión de una venta. 0 si está anulada o no tiene % congelado. */
export function comisionDeVenta(v: VentaComisionable): number {
  if (v.cancelledAt || v.commissionRate == null) return 0;
  return round2((baseComisionable(v) * v.commissionRate) / 100);
}

/** El % escrito por el admin, validado: número entre 0 y 100 con dos decimales. */
export function parsePorcentaje(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.').replace('%', '');
  if (limpio === '') return 0;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return round2(n);
}

export function formatPorcentaje(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('es-DO', { maximumFractionDigits: 2 })}%`;
}
