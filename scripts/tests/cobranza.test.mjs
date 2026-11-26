// Motopréstamos 3A: la ruta del día del cobrador y su resumen de efectivo.
// `npm test` corre `node --test`; Node quita los tipos de los .ts al importarlos.
import test from 'node:test';
import assert from 'node:assert/strict';

import { rutaDelDia, resumenDelCobrador, cuentaDesdeCuotas, TEXTO_RESULTADO } from '../../src/lib/cobranza.ts';

const HOY = '2026-11-25';

const cuenta = (over = {}) => ({
  tipo: 'prestamo', id: 'L1', customerId: 'C1', branchId: 'B1',
  pendiente: 5000, cuota: 650, mora: 0, diasAtraso: 0, venceHoy: false, ...over,
});
const asignado = (customerId, orden = 1, nombre) => ({ customerId, orden, nombre });

test('un cliente atrasado se visita con cuota más mora', () => {
  const [p, ...resto] = rutaDelDia([cuenta({ mora: 45, diasAtraso: 6 })], [asignado('C1')], [], HOY, 'orden');
  assert.equal(resto.length, 0);
  assert.equal(p.customerId, 'C1');
  assert.equal(p.sugerido, 695);
  assert.equal(p.motivo, 'atrasado');
  assert.equal(p.diasAtraso, 6);
  assert.equal(p.cuentas.length, 1);
});

test('una cuota que vence hoy entra como vence_hoy', () => {
  const [p] = rutaDelDia([cuenta({ venceHoy: true })], [asignado('C1')], [], HOY, 'orden');
  assert.equal(p.motivo, 'vence_hoy');
  assert.equal(p.sugerido, 650);
});

test('atrasado manda sobre vence_hoy y sobre la promesa', () => {
  const [p] = rutaDelDia(
    [cuenta({ venceHoy: true }), cuenta({ id: 'L2', diasAtraso: 3 })],
    [asignado('C1')], [{ customerId: 'C1', fecha: HOY, monto: 300 }], HOY, 'orden');
  assert.equal(p.motivo, 'atrasado');
  assert.equal(p.sugerido, 1300);
  assert.equal(p.promesa?.monto, 300);
});

test('una promesa de hoy sin nada atrasado se visita por la promesa, con su monto', () => {
  const [p] = rutaDelDia([cuenta()], [asignado('C1')], [{ customerId: 'C1', fecha: HOY, monto: 300 }], HOY, 'orden');
  assert.equal(p.motivo, 'promesa');
  assert.equal(p.promesa?.monto, 300);
  assert.equal(p.sugerido, 300);
});

test('una promesa de otro día no saca al cliente a la ruta', () => {
  const r = rutaDelDia([cuenta()], [asignado('C1')], [{ customerId: 'C1', fecha: '2026-11-26', monto: 300 }], HOY, 'orden');
  assert.equal(r.length, 0);
});

test('un cliente que no es de la cartera queda fuera', () => {
  const r = rutaDelDia([cuenta({ diasAtraso: 6 })], [asignado('C2')], [], HOY, 'orden');
  assert.equal(r.length, 0);
});

test('sin nada pendiente queda fuera, aunque haya promesa', () => {
  const r = rutaDelDia([cuenta({ pendiente: 0, diasAtraso: 6 })], [asignado('C1')],
    [{ customerId: 'C1', fecha: HOY, monto: 300 }], HOY, 'orden');
  assert.equal(r.length, 0);
});

test('si lo pendiente es menor que la cuota, se sugiere lo pendiente', () => {
  const [p] = rutaDelDia([cuenta({ pendiente: 400, mora: 45, diasAtraso: 2 })], [asignado('C1')], [], HOY, 'orden');
  assert.equal(p.sugerido, 400);
});

test('el sugerido suma las cuentas que tocan, por cliente, en pesos con centavos', () => {
  const [p] = rutaDelDia(
    [cuenta({ cuota: 650.1, diasAtraso: 1 }), cuenta({ id: 'V1', tipo: 'venta', cuota: 100.2, venceHoy: true }),
     cuenta({ id: 'L3', cuota: 999 })],
    [asignado('C1')], [], HOY, 'orden');
  assert.equal(p.sugerido, 750.3);
  assert.equal(p.cuentas.length, 3);
});

test('por orden: el de la cartera y, a igual orden, por nombre', () => {
  const cuentas = ['C1', 'C2', 'C3'].map((c) => cuenta({ customerId: c, id: c, diasAtraso: c === 'C3' ? 30 : 1 }));
  const r = rutaDelDia(cuentas, [asignado('C1', 2, 'Zoila'), asignado('C2', 1, 'Pedro'), asignado('C3', 2, 'Ana')], [], HOY, 'orden');
  assert.deepEqual(r.map((p) => p.customerId), ['C2', 'C3', 'C1']);
  assert.deepEqual(r.map((p) => p.orden), [1, 2, 2]);
});

test('por atraso: de más a menos días', () => {
  const cuentas = [cuenta({ customerId: 'C1', diasAtraso: 3 }), cuenta({ customerId: 'C2', diasAtraso: 40 }),
    cuenta({ customerId: 'C3', venceHoy: true })];
  const r = rutaDelDia(cuentas, [asignado('C1', 1), asignado('C2', 2), asignado('C3', 3)], [], HOY, 'atraso');
  assert.deepEqual(r.map((p) => p.customerId), ['C2', 'C1', 'C3']);
});

test('en mano: solo efectivo en la calle, sin entregar y sin anular', () => {
  const abono = (over) => ({ monto: 100, metodo: 'cash', enCalle: true, entregado: false, anulado: false, fecha: HOY, ...over });
  const r = resumenDelCobrador([
    abono({ monto: 500, fecha: '2026-11-24' }),
    abono({ monto: 200 }),
    abono({ monto: 300, metodo: 'transfer', enCalle: false }),
    abono({ monto: 50, entregado: true }),
    abono({ monto: 70, anulado: true }),
  ], HOY);
  assert.equal(r.enMano, 700);
  assert.equal(r.enManoDesde, '2026-11-24');
  assert.equal(r.cobradoHoy, 550);
});

test('sin efectivo en mano no hay fecha desde', () => {
  const r = resumenDelCobrador([], HOY);
  assert.deepEqual(r, { cobradoHoy: 0, enMano: 0, enManoDesde: undefined });
});

test('el texto de cada resultado de visita', () => {
  assert.deepEqual(TEXTO_RESULTADO, {
    pago: 'Pagó', no_estaba: 'No estaba', no_tenia: 'No tenía', promesa: 'Prometió pagar',
    se_nego: 'Se negó', moto_no_aparece: 'La moto no aparece',
  });
});

const base = { tipo: 'prestamo', id: 'L1', customerId: 'C1', branchId: 'B1', pendiente: 3000, mora: 45 };
const cuotaDe = (dueDate, amount, paidAmount = 0) => ({ dueDate, amount, paidAmount, status: paidAmount >= amount ? 'paid' : paidAmount > 0 ? 'partial' : 'pending' });

test('cuenta desde sus cuotas: lo vencido más la de hoy, días de atraso y la próxima', () => {
  const c = cuentaDesdeCuotas({ ...base, cuotas: [
    cuotaDe('2026-11-18', 650, 650), cuotaDe('2026-11-19', 650, 100), cuotaDe(HOY, 650), cuotaDe('2026-12-02', 650),
  ] }, HOY);
  assert.equal(c.cuota, 1200);
  assert.equal(c.diasAtraso, 6);
  assert.equal(c.venceHoy, true);
  assert.equal(c.proximaFecha, '2026-12-02');
  assert.equal(c.mora, 45);
  assert.equal(c.pendiente, 3000);
});

test('cuenta al día: la cuota es lo que falta de la próxima', () => {
  const c = cuentaDesdeCuotas({ ...base, mora: 0, cuotas: [cuotaDe('2026-11-20', 650, 650), cuotaDe('2026-11-27', 650, 200.5)] }, HOY);
  assert.equal(c.cuota, 449.5);
  assert.equal(c.diasAtraso, 0);
  assert.equal(c.venceHoy, false);
  assert.equal(c.proximaFecha, '2026-11-27');
});

test('cuenta sin plan de cuotas (crédito simple): todo lo pendiente, sin atraso', () => {
  const c = cuentaDesdeCuotas({ ...base, tipo: 'venta', mora: 0, cuotas: [] }, HOY);
  assert.equal(c.cuota, 3000);
  assert.equal(c.diasAtraso, 0);
  assert.equal(c.venceHoy, false);
  assert.equal(c.proximaFecha, undefined);
});
