// Pruebas de la lógica de empresa suspendida (src/lib/suspension.ts).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTIVOS_SUSPENSION,
  MOTIVO_SUSPENSION_INFO,
  esMotivoSuspension,
  pantallaDeSuspension,
  fechaMasDias,
  reactivacionSugerida,
  esErrorEmpresaSuspendida,
} from '../../src/lib/suspension.ts';

test('los tres motivos tienen nombre y descripción', () => {
  assert.deepEqual(MOTIVOS_SUSPENSION, ['falta_de_pago', 'solicitud_cliente', 'revision']);
  for (const m of MOTIVOS_SUSPENSION) {
    assert.ok(MOTIVO_SUSPENSION_INFO[m].nombre);
    assert.ok(MOTIVO_SUSPENSION_INFO[m].descripcion);
  }
  assert.equal(esMotivoSuspension('falta_de_pago'), true);
  assert.equal(esMotivoSuspension('otro'), false);
  assert.equal(esMotivoSuspension(null), false);
});

test('pantalla: falta de pago le dice al admin cómo reactivarla', () => {
  const p = pantallaDeSuspension('falta_de_pago', 'Comercial Santana', true);
  assert.equal(p.titulo, 'Cuenta suspendida por falta de pago');
  assert.match(p.mensaje, /Comercial Santana/);
  assert.match(p.accion, /pago pendiente/);
  assert.match(p.mensajeSoporte, /ponerme al día/);
});

test('pantalla: un cajero no recibe instrucciones de pago, solo avisar al admin', () => {
  const p = pantallaDeSuspension('falta_de_pago', 'Comercial Santana', false);
  assert.match(p.accion, /administrador de su empresa/);
  assert.doesNotMatch(p.accion, /pago/);
});

test('pantalla: sin motivo o desconocido cae en revisión, y sin nombre usa "su empresa"', () => {
  for (const m of [null, undefined, 'raro']) {
    const p = pantallaDeSuspension(m, '', true);
    assert.equal(p.titulo, 'Cuenta suspendida temporalmente');
    assert.match(p.mensaje, /su empresa/);
  }
  assert.equal(pantallaDeSuspension('solicitud_cliente', 'X', true).titulo, 'Cuenta suspendida');
});

test('fechaMasDias', () => {
  assert.equal(fechaMasDias(7, new Date(2026, 10, 28)), '2026-12-05');
  assert.equal(fechaMasDias(0, new Date(2026, 0, 1, 23, 30)), '2026-01-01');
});

test('reactivacionSugerida: prueba vigente sigue en prueba hasta su fecha', () => {
  const r = reactivacionSugerida({ motivo: 'revision', finPrueba: '2026-11-25T03:59:59Z', ahora: new Date('2026-11-16T12:00:00Z') });
  assert.equal(r.estado, 'trial');
  assert.equal(r.pruebaHasta, fechaMasDias(0, new Date('2026-11-25T03:59:59Z')));
  assert.equal(r.soloFacturacion, false);
});

test('reactivacionSugerida: prueba vencida o falta de pago -> Activa; falta de pago en solo facturación', () => {
  const vencida = reactivacionSugerida({ motivo: 'revision', finPrueba: '2026-11-13T03:59:59Z', ahora: new Date('2026-11-16T12:00:00Z') });
  assert.equal(vencida.estado, 'active');
  assert.equal(vencida.soloFacturacion, false);
  const pago = reactivacionSugerida({ motivo: 'falta_de_pago', finPrueba: '2026-12-30T00:00:00Z', ahora: new Date('2026-11-16T12:00:00Z') });
  assert.equal(pago.estado, 'active');
  assert.equal(pago.soloFacturacion, true);
  const sinPrueba = reactivacionSugerida({ motivo: null, finPrueba: null, ahora: new Date(2026, 10, 16) });
  assert.equal(sinPrueba.estado, 'active');
  assert.equal(sinPrueba.pruebaHasta, '2026-11-23');
});

test('esErrorEmpresaSuspendida reconoce el error del trigger', () => {
  assert.equal(esErrorEmpresaSuspendida({ hint: 'empresa_suspendida', message: 'x' }), true);
  assert.equal(esErrorEmpresaSuspendida({ message: 'La cuenta de esta empresa está suspendida. Para…' }), true);
  assert.equal(esErrorEmpresaSuspendida({ message: 'duplicate key' }), false);
  assert.equal(esErrorEmpresaSuspendida(null), false);
});
