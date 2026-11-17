// Precio con y sin ITBIS en el formulario de producto: la misma cuenta que la caja.
import test from 'node:test';
import assert from 'node:assert/strict';

import { desglosarPrecio, guardadoDesdeFinal, guardadoDesdeBase } from '../../src/lib/precio-itbis.ts';

test('ITBIS encima: 550.85 cobra 650.00', () => {
  assert.deepEqual(desglosarPrecio(550.85, false, true, 0.18), { sinItbis: 550.85, itbis: 99.15, conItbis: 650 });
});

test('ITBIS encima: 84.75 cobra 100.01, como la caja', () => {
  assert.deepEqual(desglosarPrecio(84.75, false, true, 0.18), { sinItbis: 84.75, itbis: 15.26, conItbis: 100.01 });
});

test('ITBIS incluido: 650 se desglosa hacia adentro', () => {
  assert.deepEqual(desglosarPrecio(650, true, true, 0.18), { sinItbis: 550.85, itbis: 99.15, conItbis: 650 });
});

test('sin ITBIS no hay desglose', () => {
  assert.deepEqual(desglosarPrecio(650, false, false, 0.18), { sinItbis: 650, itbis: 0, conItbis: 650 });
  assert.deepEqual(desglosarPrecio(650, true, false, 0.18), { sinItbis: 650, itbis: 0, conItbis: 650 });
});

test('del precio final al guardado', () => {
  assert.equal(guardadoDesdeFinal(650, false, 0.18), 550.85);
  assert.equal(guardadoDesdeFinal(100, false, 0.18), 84.75);
  assert.equal(guardadoDesdeFinal(650, true, 0.18), 650);
});

test('del precio base al guardado', () => {
  assert.equal(guardadoDesdeBase(550.85, false, 0.18), 550.85);
  assert.equal(guardadoDesdeBase(550.85, true, 0.18), 650);
});

test('entradas inválidas dan null', () => {
  assert.equal(desglosarPrecio(NaN, false, true, 0.18), null);
  assert.equal(guardadoDesdeFinal(-1, false, 0.18), null);
  assert.equal(guardadoDesdeBase(NaN, true, 0.18), null);
});

test('el precio guardado se redondea a centavos', () => {
  assert.equal(guardadoDesdeFinal(650.005, true, 0.18), 650.01);
  assert.equal(guardadoDesdeBase(10.004, false, 0.18), 10);
});
