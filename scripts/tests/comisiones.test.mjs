// Pruebas de la cuenta de comisiones (src/lib/comisiones.ts). La base congela el
// % en cada venta; aquí solo se comprueba la aritmética y qué no comisiona.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baseComisionable,
  comisionDeVenta,
  parsePorcentaje,
  formatPorcentaje,
} from '../../src/lib/comisiones.ts';

test('la base es lo vendido sin ITBIS', () => {
  assert.equal(baseComisionable({ total: 1180, itbisAmount: 180 }), 1000);
  assert.equal(baseComisionable({ total: 500, itbisAmount: 0 }), 500);
});

test('la comisión es el % congelado sobre la base', () => {
  assert.equal(comisionDeVenta({ total: 1180, itbisAmount: 180, commissionRate: 5 }), 50);
  assert.equal(comisionDeVenta({ total: 1000, itbisAmount: 0, commissionRate: 3.5 }), 35);
  // Redondeo a centavos.
  assert.equal(comisionDeVenta({ total: 333.33, itbisAmount: 0, commissionRate: 2.5 }), 8.33);
});

test('sin % congelado no comisiona (venta de antes del módulo o sin membresía)', () => {
  assert.equal(comisionDeVenta({ total: 1000, itbisAmount: 0 }), 0);
  assert.equal(comisionDeVenta({ total: 1000, itbisAmount: 0, commissionRate: null }), 0);
});

test('una venta anulada no comisiona', () => {
  assert.equal(
    comisionDeVenta({ total: 1000, itbisAmount: 0, commissionRate: 5, cancelledAt: new Date() }),
    0,
  );
});

test('un % de 0 comisiona 0', () => {
  assert.equal(comisionDeVenta({ total: 1000, itbisAmount: 0, commissionRate: 0 }), 0);
});

test('parsePorcentaje acepta coma, signo de % y vacío; rechaza fuera de rango', () => {
  assert.equal(parsePorcentaje('5'), 5);
  assert.equal(parsePorcentaje(' 2,5 '), 2.5);
  assert.equal(parsePorcentaje('10%'), 10);
  assert.equal(parsePorcentaje(''), 0);
  assert.equal(parsePorcentaje('3.456'), 3.46);
  assert.equal(parsePorcentaje('101'), null);
  assert.equal(parsePorcentaje('-1'), null);
  assert.equal(parsePorcentaje('abc'), null);
});

test('formatPorcentaje', () => {
  assert.equal(formatPorcentaje(null), '—');
  assert.equal(formatPorcentaje(undefined), '—');
  assert.equal(formatPorcentaje(5), '5%');
});
