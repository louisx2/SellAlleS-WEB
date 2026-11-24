// Contrato de Motopréstamos: plantillas, marcadores y llenado (src/lib/contrato.ts).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRATO_BASE, MARCADORES, garantesComoTexto, llenarContrato, marcadoresDesconocidos, montoRD,
} from '../../src/lib/contrato.ts';

const texto = (segmentos) => segmentos.map((s) => (s.tipo === 'texto' ? s.texto : '[PLAN]')).join('');

test('llena los datos del cliente y de la moto', () => {
  const s = llenarContrato('Yo, {cliente.nombre}, cédula {cliente.cedula}, recibo la {vehiculo.marca} chasis {vehiculo.chasis}.', {
    'cliente.nombre': 'Juan Pérez', 'cliente.cedula': '001-1234567-8', 'vehiculo.marca': 'Honda', 'vehiculo.chasis': 'ABC123',
  });
  assert.equal(texto(s), 'Yo, Juan Pérez, cédula 001-1234567-8, recibo la Honda chasis ABC123.');
});

test('un dato que falta o viene vacío sale como raya para llenar a mano', () => {
  const s = llenarContrato('Placa {vehiculo.placa}, color {vehiculo.color}.', { 'vehiculo.placa': '  ' });
  assert.equal(texto(s), 'Placa ________, color ________.');
});

test('un marcador desconocido queda igual y se avisa', () => {
  const plantilla = 'Hola {cliente.nombre} {marcador_raro} y {otro.raro} {marcador_raro}';
  assert.equal(texto(llenarContrato(plantilla, { 'cliente.nombre': 'Ana' })), 'Hola Ana {marcador_raro} y {otro.raro} {marcador_raro}');
  assert.deepEqual(marcadoresDesconocidos(plantilla), ['{marcador_raro}', '{otro.raro}']);
});

test('{plan} parte el texto donde va la tabla de cuotas', () => {
  const s = llenarContrato('Antes {plan} medio {plan} fin', {});
  assert.deepEqual(s.map((x) => x.tipo), ['texto', 'plan', 'texto', 'plan', 'texto']);
  assert.equal(texto(s), 'Antes [PLAN] medio [PLAN] fin');
  assert.deepEqual(llenarContrato('Sin tabla', {}), [{ tipo: 'texto', texto: 'Sin tabla' }]);
});

test('los textos base solo usan marcadores conocidos y terminan con el aviso', () => {
  for (const tipo of ['venta', 'prestamo']) {
    assert.deepEqual(marcadoresDesconocidos(CONTRATO_BASE[tipo]), [], tipo);
    assert.match(CONTRATO_BASE[tipo].trim(), /Revíselo con su abogado antes de usarlo\.$/, tipo);
    assert.match(CONTRATO_BASE[tipo], /\{plan\}/, tipo);
    assert.match(CONTRATO_BASE[tipo], /\{vehiculo\.chasis\}/, tipo);
  }
  assert.ok(MARCADORES.some((m) => m.clave === 'garantes'));
});

test('montos en pesos dominicanos', () => {
  assert.equal(montoRD(12500), 'RD$12,500.00');
  assert.equal(montoRD(0), 'RD$0.00');
  assert.equal(montoRD(undefined), '');
});

test('garantes en una línea, con o sin cédula', () => {
  assert.equal(
    garantesComoTexto([{ name: 'Juana Pérez', idDoc: '001-0000000-1', phone: '809-555-0001' }, { name: 'Pedro Gómez' }]),
    'Juana Pérez, cédula 001-0000000-1, tel. 809-555-0001; Pedro Gómez',
  );
  assert.equal(garantesComoTexto([]), '');
});
