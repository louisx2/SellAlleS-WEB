// Motopréstamos 4A, revisión final: lo dado de baja deja de verse como deuda.
// Un préstamo cerrado con el saldo de baja (`cancelled`) y una venta recuperada
// (`recoveredAt`) no deben, no están atrasados ni generan mora (lo aplican
// calculateLoanStatus y calculateFinancingStatus), y el 607 sigue reportando a
// crédito la parte que no se cobró.
import test from 'node:test';
import assert from 'node:assert/strict';

import { deudaCerrada, estadoSinDeuda, itbisQueRebajaLaNota } from '../../src/lib/motos-recuperacion.ts';
import { classify607, DGII_607_HEADERS } from '../../src/lib/dgii-607.ts';

test('deuda cerrada: préstamo con el saldo dado de baja o venta recuperada', () => {
  assert.equal(deudaCerrada({ status: 'cancelled' }), true);
  assert.equal(deudaCerrada({ status: 'paid', recoveredAt: new Date('2026-05-01') }), true);
  assert.equal(deudaCerrada({ status: 'active' }), false);
  assert.equal(deudaCerrada({ status: 'refinanced' }), false);
  assert.equal(deudaCerrada({ paymentStatus: 'in_financing' }), false);
});

test('el estado de una deuda cerrada: nada pendiente, nada atrasado, sin mora ni próxima cuota', () => {
  const abierto = {
    installmentsPaid: 1, totalInstallments: 4, nextDueDate: new Date('2026-01-15'), pendingBalance: 8000,
    isOverdue: true, lateFee: 412.5, paymentDue: 3162.5, installmentAmount: 2750, lateFeePolicy: { rate: 5 },
  };
  assert.deepEqual(estadoSinDeuda(abierto), {
    installmentsPaid: 1, totalInstallments: 4, nextDueDate: null, pendingBalance: 0,
    isOverdue: false, lateFee: 0, paymentDue: 0, installmentAmount: 2750, lateFeePolicy: { rate: 5 },
  });
});

test('607: la venta a crédito recuperada reporta lo cobrado por su método y el resto a crédito', () => {
  const venta = {
    id: 's2', items: [], subtotal: 95000, itbisAmount: 0, total: 95000,
    paymentMethod: 'credit', paymentStatus: 'paid', amountPaid: 20000, downPaymentMethod: 'transfer',
    createdAt: new Date('2026-01-01'), branchId: 'Principal', payments: [],
    ncf: 'B0200000001', ncfType: 'consumo', recoveredAt: new Date('2026-05-01'), writtenOffAmount: 75000,
  };
  const { rows } = classify607([venta]);
  assert.equal(rows.length, 1);
  assert.ok(DGII_607_HEADERS.includes('Efectivo') && DGII_607_HEADERS.includes('Venta a Crédito'));
  const campo = (nombre) => Number(rows[0].fields[DGII_607_HEADERS.indexOf(nombre)] || 0);
  assert.equal(campo('Venta a Crédito'), 75000);
  assert.equal(campo('Efectivo'), 0);
});

const notaDeRecuperacion = (extra = {}) => ({
  id: 'n1', saleId: 's2', customerName: 'Cliente', ncf: 'B0400000001', ncfModified: 'B0200000001',
  subtotal: 84745.76, itbisAmount: 15254.24, total: 100000, createdAt: new Date('2026-05-01T15:00:00Z'),
  kind: 'recuperacion', ...extra,
});

test('607: la nota de una recuperación reversa venta a crédito, no efectivo', () => {
  const { rows } = classify607([], [notaDeRecuperacion()]);
  assert.equal(rows.length, 1);
  const campo = (nombre) => Number(rows[0].fields[DGII_607_HEADERS.indexOf(nombre)] || 0);
  assert.equal(campo('Venta a Crédito'), 100000);
  assert.equal(campo('Efectivo'), 0);
  assert.equal(campo('Cheque/Transferencia'), 0);
});

test('607: la nota de una anulación sigue en el método con que se devolvió', () => {
  const { rows } = classify607([], [notaDeRecuperacion({ kind: 'anulacion', refundMethod: 'transfer', total: 118 })]);
  const campo = (nombre) => Number(rows[0].fields[DGII_607_HEADERS.indexOf(nombre)] || 0);
  assert.equal(campo('Cheque/Transferencia'), 118);
  assert.equal(campo('Venta a Crédito'), 0);
});

test('ITBIS que rebaja la nota: la de recuperación con más de 30 días no rebaja', () => {
  const nota = (creada) => ({ kind: 'recuperacion', itbisAmount: 15254.24, createdAt: new Date(creada) });
  const venta = new Date('2026-04-01T15:00:00Z');
  // 1 de abril → 1 de mayo son 30 días: todavía rebaja; → 2 de mayo son 31: ya no.
  assert.equal(itbisQueRebajaLaNota(nota('2026-05-01T15:00:00Z'), venta), 15254.24);
  assert.equal(itbisQueRebajaLaNota(nota('2026-05-02T15:00:00Z'), venta), 0);
  // Sin la fecha de la venta no se puede saber: rebaja, como hasta hoy.
  assert.equal(itbisQueRebajaLaNota(nota('2026-07-01T15:00:00Z'), undefined), 15254.24);
  // Las anulaciones siguen como hasta hoy.
  assert.equal(itbisQueRebajaLaNota({ kind: 'anulacion', itbisAmount: 18, createdAt: new Date('2026-07-01T15:00:00Z') }, venta), 18);
});
