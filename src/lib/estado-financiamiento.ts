// Estado del financiamiento que se le manda al cliente (cuotas, pagos y
// balance). Lo prueban con `node --test`: solo sintaxis TS borrable.
import type { CreditPayment } from './types';

/** Los pagos que el cliente ve: sin los anulados (para él no ocurrieron) y del
 *  más viejo al más nuevo, como se lee un historial. */
export function abonosDelEstado(payments: CreditPayment[]): CreditPayment[] {
  return payments
    .filter((p) => !p.voidedAt)
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
