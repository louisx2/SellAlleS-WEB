// Qué dice el saldo del recibo de abono según de qué cuenta es. Sin esto, un
// abono de préstamo decía «Deuda restante del cliente» con el saldo de ese solo
// préstamo, y el cliente leía que ya no debía lo de la moto financiada.
// Lógica pura. Pruebas: scripts/tests/cobranza.test.mjs

export type CuentaDelRecibo = 'prestamo' | 'venta' | 'cliente';

export function etiquetaDelSaldo(cuenta?: CuentaDelRecibo, saleId?: string): string {
  if (cuenta === 'prestamo') return 'Saldo restante del préstamo:';
  if (cuenta === 'venta' || saleId) return 'Saldo restante de la venta:';
  return 'Deuda restante del cliente:';
}

/** En el abono a una venta también se muestra la deuda total del cliente. */
export function muestraDeudaTotal(cuenta?: CuentaDelRecibo, saleId?: string): boolean {
  return cuenta === 'venta' || (!cuenta && !!saleId);
}
