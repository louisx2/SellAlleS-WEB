// Pruebas de los totales que se cobran y se guardan (src/lib/totales-venta.ts).
// `npm test` corre `node --test`; Node quita los tipos del archivo al importarlo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ventaExentaDeItbis, totalesDeLaVenta } from '../../src/lib/totales-venta.ts';

test('Régimen especial con comprobante: la venta va exenta de ITBIS', () => {
  assert.equal(ventaExentaDeItbis(true, 'regimen_especial'), true);
});

test('Sin comprobante el tipo del cliente no cambia el ITBIS', () => {
  assert.equal(ventaExentaDeItbis(false, 'regimen_especial'), false);
});

test('Los demás tipos llevan ITBIS como siempre', () => {
  for (const tipo of ['consumer', 'fiscal', 'gubernamental', undefined, null]) {
    assert.equal(ventaExentaDeItbis(true, tipo), false, String(tipo));
  }
});

test('ITBIS aparte: exenta cobra el subtotal, sin ITBIS', () => {
  const t = totalesDeLaVenta({ subtotal: 300, itbisAmount: 54, total: 354, itbisIncluded: false }, true);
  assert.deepEqual(t, { subtotal: 300, itbisAmount: 0, total: 300 });
});

test('ITBIS incluido: exenta cobra el precio de góndola completo, sin desglosar ITBIS', () => {
  const t = totalesDeLaVenta({ subtotal: 254.24, itbisAmount: 45.76, total: 300, itbisIncluded: true }, true);
  assert.deepEqual(t, { subtotal: 300, itbisAmount: 0, total: 300 });
});

test('No exenta: los totales del carrito, redondeados a centavos', () => {
  const t = totalesDeLaVenta({ subtotal: 300, itbisAmount: 54, total: 354, itbisIncluded: false }, false);
  assert.deepEqual(t, { subtotal: 300, itbisAmount: 54, total: 354 });
});

test('Cantidades decimales: el total se redondea a centavos (2.375 lb x 47.50 con ITBIS)', () => {
  // El carrito da 112.8125 + 20.31 = 133.1225; se cobra y se guarda 133.12. Sin
  // redondear, "Monto Pagado" salía 133.1225 y pagar 133.12 justo no dejaba confirmar.
  const t = totalesDeLaVenta({ subtotal: 112.8125, itbisAmount: 20.31, total: 133.1225, itbisIncluded: false }, false);
  assert.deepEqual(t, { subtotal: 112.81, itbisAmount: 20.31, total: 133.12 });
});

test('Exenta con cantidades decimales también se redondea', () => {
  const t = totalesDeLaVenta({ subtotal: 112.8125, itbisAmount: 20.31, total: 133.1225, itbisIncluded: false }, true);
  assert.deepEqual(t, { subtotal: 112.81, itbisAmount: 0, total: 112.81 });
});
