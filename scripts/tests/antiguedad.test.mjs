// Reporte de antigüedad de cartera: tramos de días de atraso y agrupación por
// cliente de préstamos, financiamientos y crédito simple.
import test from 'node:test';
import assert from 'node:assert/strict';

import { agruparCartera, tramoDe, TRAMOS } from '../../src/lib/antiguedad.ts';

const cuenta = (o) => ({ id: 'x', tipo: 'prestamo', clienteId: 'c1', cliente: 'Juan', telefono: '809', saldo: 0, diasAtraso: 0, ...o });

test('tramos en el orden del reporte', () => {
  assert.deepEqual(TRAMOS.map((t) => t.label), ['Al día', '1–7', '8–15', '16–30', '31–60', '61–90', '+90']);
});

test('días de atraso a su tramo, con los bordes', () => {
  const casos = [[0, 'al_dia'], [1, 'd1_7'], [7, 'd1_7'], [8, 'd8_15'], [15, 'd8_15'], [16, 'd16_30'], [30, 'd16_30'],
    [31, 'd31_60'], [60, 'd31_60'], [61, 'd61_90'], [90, 'd61_90'], [91, 'd90_mas']];
  for (const [dias, tramo] of casos) assert.equal(tramoDe(dias), tramo, `${dias} días`);
});

test('un cliente con préstamo y financiamiento en tramos distintos es una sola fila', () => {
  const { filas } = agruparCartera([
    cuenta({ id: 'p1', tipo: 'prestamo', saldo: 1000, diasAtraso: 3 }),
    cuenta({ id: 'f1', tipo: 'financiamiento', saldo: 500, diasAtraso: 40 }),
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].porTramo.d1_7, 1000);
  assert.equal(filas[0].porTramo.d31_60, 500);
  assert.equal(filas[0].total, 1500);
  assert.equal(filas[0].diasMax, 40);
});

test('el crédito simple sin plan va aparte', () => {
  const { filas, totales } = agruparCartera([cuenta({ tipo: 'credito', saldo: 300, diasAtraso: null })]);
  assert.equal(filas[0].sinPlan, 300);
  assert.equal(filas[0].total, 300);
  assert.equal(TRAMOS.reduce((a, t) => a + filas[0].porTramo[t.key], 0), 0);
  assert.equal(totales.sinPlan, 300);
});

test('una cuenta sin saldo no aparece', () => {
  assert.equal(agruparCartera([cuenta({ saldo: 0, diasAtraso: 12 })]).filas.length, 0);
});

test('lo vencido no cuenta lo que está al día ni lo que no tiene plan', () => {
  const { totales } = agruparCartera([
    cuenta({ id: 'a', clienteId: 'c1', saldo: 1000, diasAtraso: 0 }),
    cuenta({ id: 'b', clienteId: 'c2', saldo: 200, diasAtraso: 10 }),
    cuenta({ id: 'c', clienteId: 'c3', saldo: 300, diasAtraso: 100 }),
    cuenta({ id: 'd', clienteId: 'c4', tipo: 'credito', saldo: 50, diasAtraso: null }),
  ]);
  assert.equal(totales.vencido, 500);
  assert.equal(totales.total, 1550);
  assert.equal(totales.al_dia, 1000);
});

test('primero el cliente con más días de atraso', () => {
  const { filas } = agruparCartera([
    cuenta({ id: 'a', clienteId: 'c1', cliente: 'Ana', saldo: 9000, diasAtraso: 2 }),
    cuenta({ id: 'b', clienteId: 'c2', cliente: 'Beto', saldo: 100, diasAtraso: 45 }),
  ]);
  assert.deepEqual(filas.map((f) => f.cliente), ['Beto', 'Ana']);
});
