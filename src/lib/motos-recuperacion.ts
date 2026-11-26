// Motopréstamos 4A: reglas de la recuperación de motos. Lógica pura: la usan la
// ficha, los diálogos y el reporte. La base vuelve a validar todo en sus RPC
// (motos_incautar, motos_devolver_garantia, motos_liquidar_garantia y
// motos_recuperar_venta); esto solo decide qué botones mostrar y qué cifras
// adelantar en pantalla.

import type { VehicleOrigin, VehicleStatus } from '@/lib/motos';

export type AccionDeRecuperacion = 'incautar' | 'devolver' | 'liquidar' | 'recuperar_venta';
export type EstadoDeRecuperacion = 'incautada' | 'devuelta' | 'liquidada' | 'recuperada';

export const TEXTO_ESTADO_RECUPERACION: Record<EstadoDeRecuperacion, string> = {
  incautada: 'Incautada',
  devuelta: 'Devuelta',
  liquidada: 'Liquidada',
  recuperada: 'Recuperada',
};

/**
 * Acciones de recuperación que se ofrecen para una moto.
 * - `incautar`: garantía de un préstamo activo; quien puede editar motos.
 * - `devolver`: garantía incautada; quien puede editar motos.
 * - `liquidar`: garantía incautada con el préstamo activo; solo el administrador.
 * - `recuperar_venta`: moto del inventario vendida con la venta abierta; solo el administrador.
 * El administrador puede editar motos aunque su rol no lo diga (igual que en la base).
 */
export function accionesDeRecuperacion(
  v: { status: VehicleStatus; origin: VehicleOrigin; saleId?: string; loanId?: string },
  venta?: { abierta: boolean },
  prestamo?: { activo: boolean },
  esAdmin = false,
  puedeEditar = false,
): AccionDeRecuperacion[] {
  const edita = puedeEditar || esAdmin;
  const acciones: AccionDeRecuperacion[] = [];
  if (v.origin === 'garantia' && v.loanId) {
    if (v.status === 'en_garantia' && prestamo?.activo && edita) acciones.push('incautar');
    if (v.status === 'recuperado') {
      if (edita) acciones.push('devolver');
      if (esAdmin && prestamo?.activo) acciones.push('liquidar');
    }
  }
  if (v.origin === 'inventario' && v.status === 'vendido' && v.saleId && venta?.abierta && esAdmin) {
    acciones.push('recuperar_venta');
  }
  return acciones;
}

const aCentavos = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);

/**
 * Cómo se reparte lo que paga la liquidación de una garantía: lo aplicado al
 * préstamo (hasta la deuda con mora), lo que sobra para el cliente y lo que falta.
 */
export function repartoDeLiquidacion(deuda: number, monto: number): { aplicado: number; sobrante: number; faltante: number } {
  const d = Math.max(aCentavos(deuda), 0);
  const m = Math.max(aCentavos(monto), 0);
  const aplicado = Math.min(d, m);
  return { aplicado: aplicado / 100, sobrante: (m - aplicado) / 100, faltante: (d - aplicado) / 100 };
}

/**
 * Deuda cerrada sin cobrarse entera: el préstamo se cerró con el saldo dado de
 * baja (`cancelled`, al liquidar la garantía) o la venta se recuperó. Sus cuotas
 * quedan abiertas en la base, pero ya no se deben.
 */
export function deudaCerrada(c: { status?: string; recoveredAt?: Date | null }): boolean {
  return c.status === 'cancelled' || !!c.recoveredAt;
}

/** El estado de cuenta de una deuda cerrada: nada pendiente ni atrasado, sin mora ni próxima cuota. */
export function estadoSinDeuda<T extends { pendingBalance: number; isOverdue: boolean; lateFee: number; paymentDue: number; nextDueDate: Date | null }>(st: T): T {
  return { ...st, pendingBalance: 0, isOverdue: false, lateFee: 0, paymentDue: 0, nextDueDate: null };
}

/**
 * Lo recuperado en una recuperación, para el reporte: en la venta, el valor con
 * que la moto vuelve al inventario; en la garantía liquidada, lo que pagó el
 * tercero o la tasación de la dación. Incautada o devuelta: nada todavía.
 */
export function recuperadoDe(r: {
  kind: 'venta' | 'garantia';
  status: EstadoDeRecuperacion;
  reentryValue?: number;
  proceeds?: number;
}): number {
  if (r.kind === 'venta') return r.reentryValue ?? 0;
  if (r.status === 'liquidada') return r.proceeds ?? 0;
  return 0;
}

/**
 * Monto de la nota de crédito de una venta recuperada (4B): lo que no se cobró del
 * valor facturado. La factura no lleva intereses y lo abonado cubrió capital e
 * interés, así que se prorratea contra el total a pagar; lo devuelto al cliente
 * también cuenta como no cobrado. Es la vista previa del diálogo: la base calcula
 * el monto final desde las líneas de la venta (puede diferir en un centavo).
 */
export function montoNotaDeRecuperacion(v: {
  totalFacturado: number;
  totalAPagar: number;
  dadoDeBaja: number;
  devuelto: number;
}): number {
  const aPagar = aCentavos(v.totalAPagar);
  const noCobrado = Math.max(aCentavos(v.dadoDeBaja) + aCentavos(v.devuelto), 0);
  if (aPagar <= 0 || noCobrado <= 0) return 0;
  const factor = Math.min(1, noCobrado / aPagar);
  return Math.round(aCentavos(v.totalFacturado) * factor) / 100;
}

/** Días que puede pasar una nota de crédito después de su factura y seguir rebajando el ITBIS. */
export const DIAS_NOTA_REBAJA_ITBIS = 30;

const diasCalendario = (desde: Date, hasta: Date) =>
  Math.round(
    (Date.UTC(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())
      - Date.UTC(desde.getFullYear(), desde.getMonth(), desde.getDate())) / 86_400_000,
  );

/**
 * ITBIS que rebaja una nota de crédito en el reporte de impuestos. La nota de una
 * venta recuperada emitida más de 30 días después de la factura no lo rebaja (por
 * eso su E34 sale con IndicadorNotaCredito 1). Las anulaciones siguen como hasta hoy,
 * y sin la fecha de la venta no hay cómo saberlo: rebaja.
 */
export function itbisQueRebajaLaNota(
  nota: { kind?: string; itbisAmount: number; createdAt: Date },
  fechaVenta?: Date,
): number {
  if (nota.kind !== 'recuperacion' || !fechaVenta) return nota.itbisAmount;
  return diasCalendario(fechaVenta, nota.createdAt) > DIAS_NOTA_REBAJA_ITBIS ? 0 : nota.itbisAmount;
}

/** Resultado de una recuperación para el reporte: recuperado − dado de baja − devuelto. */
export function resultadoDeRecuperacion(r: { recuperado: number; dadoDeBaja: number; devuelto: number }): number {
  return (aCentavos(r.recuperado) - aCentavos(r.dadoDeBaja) - aCentavos(r.devuelto)) / 100;
}
