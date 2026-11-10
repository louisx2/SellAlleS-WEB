// Pruebas de la ganancia sobre el costo: del % al precio y del precio al %.
import test from 'node:test';
import assert from 'node:assert/strict';

import { precioConGanancia, gananciaDelPrecio, factorItbis, formatoPorcentaje } from '../../src/lib/margen.ts';

test('costo 1,000 con 30 % de ganancia sale en 1,300', () => {
  assert.equal(precioConGanancia(1000, 30), 1300);
});

test('precio 1,300 sobre costo 1,000 es 30 % y RD$300', () => {
  assert.deepEqual(gananciaDelPrecio(1000, 1300), { monto: 300, porcentaje: 30 });
});

test('el precio se redondea a centavos', () => {
  assert.equal(precioConGanancia(999.99, 33.333), 1333.32);
});

test('con ITBIS incluido la ganancia se calcula sin el impuesto', () => {
  const f = factorItbis(true, true, 0.18);
  assert.equal(f, 1.18);
  assert.equal(precioConGanancia(1000, 30, f), 1534);
  const g = gananciaDelPrecio(1000, 1534, f);
  assert.equal(g.monto, 300);
  assert.ok(Math.abs(g.porcentaje - 30) < 1e-9);
});

test('el ITBIS solo pesa si la sucursal lo incluye y el producto lo lleva', () => {
  assert.equal(factorItbis(true, false, 0.18), 1);
  assert.equal(factorItbis(false, true, 0.18), 1);
});

test('vender por debajo del costo da ganancia negativa', () => {
  assert.deepEqual(gananciaDelPrecio(1000, 900), { monto: -100, porcentaje: -10 });
});

test('sin costo no hay ganancia que calcular', () => {
  assert.equal(precioConGanancia(0, 30), null);
  assert.equal(gananciaDelPrecio(0, 500), null);
  assert.equal(gananciaDelPrecio(Number.NaN, 500), null);
});

test('un porcentaje o precio inválido no calcula', () => {
  assert.equal(precioConGanancia(1000, Number.NaN), null);
  assert.equal(gananciaDelPrecio(1000, Number.NaN), null);
  assert.equal(gananciaDelPrecio(1000, -5), null);
});

test('el porcentaje se muestra con hasta dos decimales', () => {
  assert.equal(formatoPorcentaje(30), '30');
  assert.equal(formatoPorcentaje(33.3333), '33.33');
  assert.equal(formatoPorcentaje(-10), '-10');
});
