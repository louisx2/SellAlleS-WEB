// Qué reinicia el diálogo de pago cuando cambia el cliente del carrito.
//
// Al abrir el diálogo, o si el cliente cambia por otra vía, todo vuelve a su
// valor inicial (método, monto, comprobante y tipo). Pero si el cliente lo acaba
// de poner "RNC del comprador" (queda marcado por su id), lo que el cajero ya
// eligió se conserva y solo el monto sigue al total nuevo: ese cliente puede
// tener descuento. Con el diálogo cerrado no hay nada que reiniciar.

export type ReinicioDePago = 'ninguno' | 'solo_monto' | 'completo';

export function reinicioAlCambiarCliente(
  abierto: boolean,
  marca: string | null,
  clienteId: string | undefined,
): ReinicioDePago {
  if (!abierto) return 'ninguno';
  if (marca && marca === clienteId) return 'solo_monto';
  return 'completo';
}

/**
 * El cupón del carrito al poner un cliente. Un cupón es de un cliente: si cambia
 * el cliente se descarta. Si es el mismo (por ejemplo, "RNC del comprador" le
 * acaba de guardar el RNC y lo vuelve a poner), se conserva.
 */
export function cuponAlCambiarCliente<T>(idAnterior: string | undefined, idNuevo: string, cupon: T | undefined): T | undefined {
  return idAnterior === idNuevo ? cupon : undefined;
}
