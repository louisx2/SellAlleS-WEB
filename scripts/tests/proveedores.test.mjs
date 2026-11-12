// Pruebas de las condiciones de un proveedor (src/lib/proveedores.ts): los días
// de crédito que se escriben en su ficha, el vencimiento que eso pone en una
// factura de Cuentas por Pagar, y el nombre comercial que trae la DGII al
// escribir el RNC. Node quita los tipos: proveedores.ts solo puede tener
// `import type`.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  leerDiasDeCredito,
  vencimientoSugerido,
  condicionesDelProveedor,
  vencimientoAlCambiarFecha,
  nombreComercialDeDgii,
} from '../../src/lib/proveedores.ts';

test('días de crédito: vacío es "sin plazo", un entero de 0 a 365 vale, lo demás no', () => {
  assert.deepEqual(leerDiasDeCredito(''), { ok: true, dias: null });
  assert.deepEqual(leerDiasDeCredito('   '), { ok: true, dias: null });
  assert.deepEqual(leerDiasDeCredito('0'), { ok: true, dias: 0 });
  assert.deepEqual(leerDiasDeCredito(' 30 '), { ok: true, dias: 30 });
  assert.deepEqual(leerDiasDeCredito('365'), { ok: true, dias: 365 });
  assert.deepEqual(leerDiasDeCredito('366'), { ok: false });
  assert.deepEqual(leerDiasDeCredito('-5'), { ok: false });
  assert.deepEqual(leerDiasDeCredito('1.5'), { ok: false });
  assert.deepEqual(leerDiasDeCredito('treinta'), { ok: false });
});

test('vencimiento: la fecha del comprobante más los días, cruzando mes y año', () => {
  assert.equal(vencimientoSugerido('2026-11-12', 30), '2026-12-12');
  assert.equal(vencimientoSugerido('2026-01-31', 30), '2026-03-02');
  assert.equal(vencimientoSugerido('2026-12-15', 30), '2027-01-14');
  assert.equal(vencimientoSugerido('2028-02-28', 1), '2028-02-29');
});

test('vencimiento: sin días, con 0 días o sin fecha válida no hay sugerencia', () => {
  assert.equal(vencimientoSugerido('2026-11-12', null), undefined);
  assert.equal(vencimientoSugerido('2026-11-12', undefined), undefined);
  assert.equal(vencimientoSugerido('2026-11-12', 0), undefined);
  assert.equal(vencimientoSugerido('', 30), undefined);
  assert.equal(vencimientoSugerido('12/11/2026', 30), undefined);
});

test('elegir un proveedor con días de crédito: a crédito, con su vencimiento y su tipo de gasto', () => {
  assert.deepEqual(condicionesDelProveedor({ creditDays: 30, expenseType606: '02' }, '2026-11-12'), {
    condition: 'credit',
    dueDate: '2026-12-12',
    expenseType: '02',
  });
});

test('elegir un proveedor de contado (0 días): al contado y sin vencimiento', () => {
  assert.deepEqual(condicionesDelProveedor({ creditDays: 0 }, '2026-11-12'), {
    condition: 'cash',
    dueDate: '',
    expenseType: '09',
  });
});

test('elegir un proveedor sin condiciones guardadas deja lo de siempre (crédito, sin vencimiento, 09)', () => {
  const lo_de_siempre = { condition: 'credit', dueDate: '', expenseType: '09' };
  assert.deepEqual(condicionesDelProveedor({ creditDays: null, expenseType606: '' }, '2026-11-12'), lo_de_siempre);
  assert.deepEqual(condicionesDelProveedor({}, '2026-11-12'), lo_de_siempre);
  assert.deepEqual(condicionesDelProveedor(undefined, '2026-11-12'), lo_de_siempre);
});

test('cambiar la fecha del comprobante mueve el vencimiento que se calculó solo', () => {
  assert.equal(vencimientoAlCambiarFecha(30, '2026-11-12', '2026-11-01', '2026-12-12'), '2026-12-01');
});

test('cambiar la fecha no toca un vencimiento escrito a mano ni uno de un proveedor sin plazo', () => {
  assert.equal(vencimientoAlCambiarFecha(30, '2026-11-12', '2026-11-01', '2026-12-20'), undefined);
  assert.equal(vencimientoAlCambiarFecha(30, '2026-11-12', '2026-11-01', ''), undefined);
  assert.equal(vencimientoAlCambiarFecha(null, '2026-11-12', '2026-11-01', '2026-12-12'), undefined);
  assert.equal(vencimientoAlCambiarFecha(0, '2026-11-12', '2026-11-01', ''), undefined);
});

test('nombre comercial: la DGII llena el campo vacío o el que ella misma había puesto', () => {
  assert.equal(nombreComercialDeDgii('POPI PEST', '', undefined), 'POPI PEST');
  assert.equal(nombreComercialDeDgii('POPI PEST', 'IT SOLUCLICK', 'IT SOLUCLICK'), 'POPI PEST');
});

test('nombre comercial: no pisa lo que se escribió a mano', () => {
  assert.equal(nombreComercialDeDgii('POPI PEST', 'Fumigadora Popi', undefined), undefined);
  assert.equal(nombreComercialDeDgii('POPI PEST', 'Fumigadora Popi', 'IT SOLUCLICK'), undefined);
});

test('nombre comercial: si la DGII no tiene, se borra solo el que ella había puesto', () => {
  assert.equal(nombreComercialDeDgii('', 'IT SOLUCLICK', 'IT SOLUCLICK'), '');
  assert.equal(nombreComercialDeDgii('  ', 'Fumigadora Popi', undefined), undefined);
  assert.equal(nombreComercialDeDgii('', '', undefined), undefined);
});

test('nombre comercial: el mismo nombre con otras mayúsculas o espacios no cambia nada', () => {
  assert.equal(nombreComercialDeDgii('POPI PEST', ' popi  pest ', undefined), undefined);
});
