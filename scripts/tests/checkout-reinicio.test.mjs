// Pruebas de qué reinicia el diálogo de pago cuando cambia el cliente del carrito
// (src/lib/checkout-reinicio.ts). "RNC del comprador" pone un cliente con "Usar":
// ahí no se puede perder lo que el cajero ya eligió (comprobante, tipo, pago),
// pero el monto sí debe seguir al total nuevo (el cliente puede tener descuento).
import test from 'node:test';
import assert from 'node:assert/strict';

import { reinicioAlCambiarCliente } from '../../src/lib/checkout-reinicio.ts';

test('cerrado no reinicia nada (y la marca se descarta)', () => {
  assert.equal(reinicioAlCambiarCliente(false, 'c1', 'c1'), 'ninguno');
  assert.equal(reinicioAlCambiarCliente(false, null, 'c1'), 'ninguno');
});

test('el cliente que puso "Usar" solo actualiza el monto, aunque tenga el mismo tipo NCF o descuento', () => {
  assert.equal(reinicioAlCambiarCliente(true, 'c1', 'c1'), 'solo_monto');
});

test('al abrir, o con otro cliente que no puso "Usar", reinicia todo como siempre', () => {
  assert.equal(reinicioAlCambiarCliente(true, null, 'c1'), 'completo');
  assert.equal(reinicioAlCambiarCliente(true, 'c1', 'c2'), 'completo');
  assert.equal(reinicioAlCambiarCliente(true, 'c1', undefined), 'completo');
});
