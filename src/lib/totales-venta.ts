// Los totales que se cobran y se guardan en una venta, a partir de los que
// calcula el carrito. Lógica pura con solo `import type`: las pruebas
// (`scripts/tests/totales-venta.test.mjs`) cargan este archivo con Node.
import type { NcfType } from './types';

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Una venta con comprobante de régimen especial (E44 o B14: zonas francas y
 * demás regímenes) va exenta de ITBIS. La DGII no acepta un E44 con líneas
 * gravadas (MSeller lo rechaza con INDICADOR_FACTURACION_NOT_ALLOWED_FOR_TYPE).
 * Sin comprobante el tipo del cliente no cuenta: la venta lleva ITBIS como siempre.
 */
export function ventaExentaDeItbis(conComprobante: boolean, ncfType?: NcfType | null): boolean {
  return conComprobante && ncfType === 'regimen_especial';
}

export interface TotalesVenta {
  subtotal: number;
  itbisAmount: number;
  total: number;
}

/**
 * Lo que se cobra: los totales del carrito redondeados a centavos (con
 * cantidades decimales el carrito da 133.1225 y se guarda 133.12), o, si la
 * venta va exenta, la suma bruta de las líneas sin ITBIS. Con ITBIS incluido el
 * precio de la góndola no cambia: la venta exenta se cobra igual, sin desglosar.
 */
export function totalesDeLaVenta(
  carrito: TotalesVenta & { itbisIncluded: boolean },
  exenta: boolean,
): TotalesVenta {
  if (exenta) {
    const bruto = centavos(carrito.itbisIncluded ? carrito.total : carrito.subtotal);
    return { subtotal: bruto, itbisAmount: 0, total: bruto };
  }
  return {
    subtotal: centavos(carrito.subtotal),
    itbisAmount: centavos(carrito.itbisAmount),
    total: centavos(carrito.total),
  };
}
