// Motopréstamos 4A: qué se puede hacer con una moto para recuperarla, cómo se
// reparte lo que paga la liquidación de una garantía y el resultado del reporte.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accionesDeRecuperacion,
  montoNotaDeRecuperacion,
  repartoDeLiquidacion,
  recuperadoDe,
  resultadoDeRecuperacion,
  TEXTO_ESTADO_RECUPERACION,
} from '../../src/lib/motos-recuperacion.ts';

const enGarantia = { status: 'en_garantia', origin: 'garantia', loanId: 'l1' };
const incautada = { status: 'recuperado', origin: 'garantia', loanId: 'l1' };
const vendida = { status: 'vendido', origin: 'inventario', saleId: 's1' };
const activo = { activo: true };
const saldado = { activo: false };
const abierta = { abierta: true };
const cerrada = { abierta: false };

test('incautar: moto en garantía de un préstamo activo y permiso de editar motos', () => {
  assert.deepEqual(accionesDeRecuperacion(enGarantia, undefined, activo, false, true), ['incautar']);
  assert.deepEqual(accionesDeRecuperacion(enGarantia, undefined, activo, false, false), []);
  assert.deepEqual(accionesDeRecuperacion(enGarantia, undefined, saldado, false, true), []);
  assert.deepEqual(accionesDeRecuperacion(enGarantia, undefined, undefined, false, true), []);
  assert.deepEqual(accionesDeRecuperacion({ ...enGarantia, loanId: undefined }, undefined, activo, false, true), []);
});

test('el administrador incauta y devuelve aunque su rol no tenga «editar motos»', () => {
  assert.deepEqual(accionesDeRecuperacion(enGarantia, undefined, activo, true, false), ['incautar']);
  assert.deepEqual(accionesDeRecuperacion(incautada, undefined, activo, true, false), ['devolver', 'liquidar']);
});

test('devolver: moto incautada y permiso de editar; liquidar: además administrador y préstamo activo', () => {
  assert.deepEqual(accionesDeRecuperacion(incautada, undefined, activo, false, true), ['devolver']);
  assert.deepEqual(accionesDeRecuperacion(incautada, undefined, activo, true, true), ['devolver', 'liquidar']);
  // Préstamo saldado con la moto incautada: solo se devuelve.
  assert.deepEqual(accionesDeRecuperacion(incautada, undefined, saldado, true, true), ['devolver']);
  assert.deepEqual(accionesDeRecuperacion(incautada, undefined, activo, false, false), []);
});

test('recuperar la venta: moto vendida con la venta abierta, solo el administrador', () => {
  assert.deepEqual(accionesDeRecuperacion(vendida, abierta, undefined, true, true), ['recuperar_venta']);
  assert.deepEqual(accionesDeRecuperacion(vendida, abierta, undefined, false, true), []);
  assert.deepEqual(accionesDeRecuperacion(vendida, cerrada, undefined, true, true), []);
  assert.deepEqual(accionesDeRecuperacion(vendida, undefined, undefined, true, true), []);
  assert.deepEqual(accionesDeRecuperacion({ ...vendida, saleId: undefined }, abierta, undefined, true, true), []);
});

test('ninguna acción en los demás estados ni con el origen cambiado', () => {
  for (const status of ['disponible', 'liberado', 'baja']) {
    assert.deepEqual(accionesDeRecuperacion({ ...enGarantia, status }, abierta, activo, true, true), [], status);
    assert.deepEqual(accionesDeRecuperacion({ ...vendida, status }, abierta, activo, true, true), [], status);
  }
  // Una moto del inventario marcada «recuperado» no es una garantía incautada.
  assert.deepEqual(accionesDeRecuperacion({ status: 'recuperado', origin: 'inventario' }, abierta, activo, true, true), []);
  // Una garantía no se «vende»: no se recupera como venta.
  assert.deepEqual(accionesDeRecuperacion({ status: 'vendido', origin: 'garantia', saleId: 's1' }, abierta, activo, true, true), []);
});

test('reparto: monto menor que la deuda deja faltante', () => {
  assert.deepEqual(repartoDeLiquidacion(12000, 3000), { aplicado: 3000, sobrante: 0, faltante: 9000 });
});

test('reparto: monto igual a la deuda salda sin sobrante ni faltante', () => {
  assert.deepEqual(repartoDeLiquidacion(11550.5, 11550.5), { aplicado: 11550.5, sobrante: 0, faltante: 0 });
});

test('reparto: monto mayor que la deuda deja sobrante', () => {
  assert.deepEqual(repartoDeLiquidacion(11550.5, 12050.5), { aplicado: 11550.5, sobrante: 500, faltante: 0 });
});

test('reparto en centavos exactos', () => {
  assert.deepEqual(repartoDeLiquidacion(0.3, 0.1 + 0.2), { aplicado: 0.3, sobrante: 0, faltante: 0 });
  assert.deepEqual(repartoDeLiquidacion(100.1, 100.3), { aplicado: 100.1, sobrante: 0.2, faltante: 0 });
  assert.deepEqual(repartoDeLiquidacion(100.3, 100.1), { aplicado: 100.1, sobrante: 0, faltante: 0.2 });
});

test('reparto sin deuda: todo es sobrante', () => {
  assert.deepEqual(repartoDeLiquidacion(0, 5000), { aplicado: 0, sobrante: 5000, faltante: 0 });
});

test('resultado: recuperado − dado de baja − devuelto', () => {
  assert.equal(resultadoDeRecuperacion({ recuperado: 50000, dadoDeBaja: 30000, devuelto: 1000 }), 19000);
  assert.equal(resultadoDeRecuperacion({ recuperado: 50000, dadoDeBaja: 75000, devuelto: 1000 }), -26000);
  assert.equal(resultadoDeRecuperacion({ recuperado: 0.3, dadoDeBaja: 0.1, devuelto: 0.2 }), 0);
});

test('recuperado: valor de reingreso en la venta, lo obtenido al liquidar, nada mientras está incautada o si se devolvió', () => {
  assert.equal(recuperadoDe({ kind: 'venta', status: 'recuperada', reentryValue: 50000 }), 50000);
  assert.equal(recuperadoDe({ kind: 'garantia', status: 'liquidada', liquidationMode: 'tercero', proceeds: 12050.5 }), 12050.5);
  assert.equal(recuperadoDe({ kind: 'garantia', status: 'liquidada', liquidationMode: 'dacion', proceeds: 6000, reentryValue: 6000 }), 6000);
  assert.equal(recuperadoDe({ kind: 'garantia', status: 'incautada' }), 0);
  assert.equal(recuperadoDe({ kind: 'garantia', status: 'devuelta' }), 0);
});

test('texto de cada estado de la recuperación', () => {
  assert.deepEqual(TEXTO_ESTADO_RECUPERACION, {
    incautada: 'Incautada',
    devuelta: 'Devuelta',
    liquidada: 'Liquidada',
    recuperada: 'Recuperada',
  });
});

test('nota de crédito de la recuperación: lo no cobrado del valor facturado', () => {
  // Crédito de 95,000 con 20,000 abonados y 1,000 devueltos al cliente.
  assert.equal(montoNotaDeRecuperacion({ totalFacturado: 95000, totalAPagar: 95000, dadoDeBaja: 75000, devuelto: 1000 }), 76000);
  // Financiada sin abonos: el factor se topa en 1 y la nota es el total facturado.
  assert.equal(montoNotaDeRecuperacion({ totalFacturado: 95000, totalAPagar: 99750, dadoDeBaja: 99750, devuelto: 0 }), 95000);
  assert.equal(montoNotaDeRecuperacion({ totalFacturado: 95000, totalAPagar: 99750, dadoDeBaja: 99750, devuelto: 5000 }), 95000);
  // Nada sin cobrar: no hay nota.
  assert.equal(montoNotaDeRecuperacion({ totalFacturado: 95000, totalAPagar: 95000, dadoDeBaja: 0, devuelto: 0 }), 0);
  // Centavos exactos.
  assert.equal(montoNotaDeRecuperacion({ totalFacturado: 0.3, totalAPagar: 0.3, dadoDeBaja: 0.1 + 0.2, devuelto: 0 }), 0.3);
  // ITBIS aparte: 118,000 con 18,000 abonados → 100,000.
  assert.equal(montoNotaDeRecuperacion({ totalFacturado: 118000, totalAPagar: 118000, dadoDeBaja: 100000, devuelto: 0 }), 100000);
});
