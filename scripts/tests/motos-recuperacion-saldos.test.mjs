// Motopréstamos 4A, revisión final: lo dado de baja deja de verse como deuda.
// Un préstamo cerrado con el saldo de baja (`cancelled`) y una venta recuperada
// (`recoveredAt`) no deben, no están atrasados ni generan mora (lo aplican
// calculateLoanStatus y calculateFinancingStatus), y el 607 sigue reportando a
// crédito la parte que no se cobró.
import test from 'node:test';
import assert from 'node:assert/strict';

import { deudaCerrada, estadoSinDeuda } from '../../src/lib/motos-recuperacion.ts';
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
