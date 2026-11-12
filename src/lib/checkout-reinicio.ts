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
