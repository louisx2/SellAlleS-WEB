// Pruebas de los abonos que salen en el estado del financiamiento que se le
// manda al cliente: sin los anulados (no ocurrieron) y en orden cronológico.
import test from 'node:test';
import assert from 'node:assert/strict';

import { abonosDelEstado } from '../../src/lib/estado-financiamiento.ts';

const abono = (id, fecha, extra = {}) => ({
  id, customerId: 'c1', kind: 'sale', amount: 1000, lateFeePaid: 0, method: 'cash',
  date: new Date(fecha), branchId: 'Principal', ...extra,
});

test('el abono anulado no aparece', () => {
  const lista = [
    abono('a', '2026-10-01T10:00:00'),
    abono('b', '2026-10-15T10:00:00', { voidedAt: new Date('2026-10-16T10:00:00'), voidReason: 'error' }),
  ];
  assert.deepEqual(abonosDelEstado(lista).map((p) => p.id), ['a']);
});

test('del más viejo al más nuevo, aunque lleguen al revés', () => {
  const lista = [
    abono('nuevo', '2026-11-01T10:00:00'),
    abono('inicial', '2026-09-01T10:00:00', { kind: 'down_payment' }),
    abono('medio', '2026-10-01T10:00:00'),
  ];
  assert.deepEqual(abonosDelEstado(lista).map((p) => p.id), ['inicial', 'medio', 'nuevo']);
});

test('no modifica la lista que recibe', () => {
  const lista = [abono('b', '2026-11-01'), abono('a', '2026-10-01')];
  abonosDelEstado(lista);
  assert.deepEqual(lista.map((p) => p.id), ['b', 'a']);
});
