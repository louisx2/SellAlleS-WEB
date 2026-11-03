// Pruebas de la lógica pura de e-CF en la app (src/lib/ecf.ts). Sin runner de
// terceros: `npm test` corre `node --test`, y Node quita los tipos de ecf.ts al
// importarlo (por eso ese archivo solo puede tener `import type`).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ECF_NOMBRE,
  esEcf,
  tipoDeEncf,
  nombreDeEncf,
  ecfFaltaRncCliente,
  documentoVigente,
  ecfEstadoEtiqueta,
  puedeReintentar,
  puedeReemitir,
  ECF_ESTADOS_CON_PROBLEMA,
  ecfConProblema,
  cuentaComoProblemaEcf,
  contarProblemasEcf,
  resultadoDeEcf,
} from '../../src/lib/ecf.ts';

// Documento mínimo para armar casos.
const doc = (over = {}) => ({
  id: 'd1',
  tipoEcf: 32,
  encf: 'E320000000001',
  estado: 'aceptado',
  createdAt: new Date('2026-11-16T10:00:00Z'),
  ...over,
});

const ESTADOS = [
  'por_enviar', 'enviando', 'recibido', 'aceptado', 'aceptado_condicional',
  'rechazado', 'error_datos', 'sin_cupo',
];

test('ECF_NOMBRE: los nombres de los tipos que salen en el ticket', () => {
  assert.equal(ECF_NOMBRE[31], 'Factura de Crédito Fiscal Electrónica');
  assert.equal(ECF_NOMBRE[32], 'Factura de Consumo Electrónica');
  assert.equal(ECF_NOMBRE[33], 'Nota de Débito Electrónica');
  assert.equal(ECF_NOMBRE[34], 'Nota de Crédito Electrónica');
  assert.equal(ECF_NOMBRE[44], 'Comprobante Electrónico para Regímenes Especiales');
  assert.equal(ECF_NOMBRE[45], 'Comprobante Electrónico Gubernamental');
});

test('esEcf: E + 12 dígitos; la serie B y lo vacío no lo son', () => {
  assert.equal(esEcf('E320000000001'), true);
  assert.equal(esEcf('E340000000123'), true);
  assert.equal(esEcf('B0200000001'), false);
  assert.equal(esEcf(undefined), false);
  assert.equal(esEcf(null), false);
  assert.equal(esEcf(''), false);
  // Largo o forma equivocados: no se adivina.
  assert.equal(esEcf('E32000000001'), false);
  assert.equal(esEcf('E3200000000011'), false);
  assert.equal(esEcf('e320000000001'), false);
  assert.equal(esEcf(' E320000000001'), false);
  assert.equal(esEcf('E32000000000A'), false);
});

test('tipoDeEncf: los dos dígitos tras la E; lo que no es e-NCF no tiene tipo', () => {
  assert.equal(tipoDeEncf('E320000000001'), 32);
  assert.equal(tipoDeEncf('E340000000123'), 34);
  assert.equal(tipoDeEncf('E310000000001'), 31);
  assert.equal(tipoDeEncf('B0200000001'), undefined);
  assert.equal(tipoDeEncf('E32000000001'), undefined);
  assert.equal(tipoDeEncf(undefined), undefined);
  assert.equal(tipoDeEncf(null), undefined);
});

test('nombreDeEncf: el nombre del tipo; uno genérico si no se conoce, nunca "undefined"', () => {
  assert.equal(nombreDeEncf('E320000000001'), 'Factura de Consumo Electrónica');
  assert.equal(nombreDeEncf('E310000000001'), 'Factura de Crédito Fiscal Electrónica');
  assert.equal(nombreDeEncf('E340000000001'), 'Nota de Crédito Electrónica');
  assert.equal(nombreDeEncf('E450000000001'), 'Comprobante Electrónico Gubernamental');
  // Tipo que no está en ECF_NOMBRE (E00, E99): título genérico.
  assert.equal(nombreDeEncf('E000000000001'), 'Comprobante Fiscal Electrónico');
  assert.equal(nombreDeEncf('E990000000001'), 'Comprobante Fiscal Electrónico');
  // No es e-NCF: tampoco rompe.
  assert.equal(nombreDeEncf('B0200000001'), 'Comprobante Fiscal Electrónico');
  assert.equal(nombreDeEncf(undefined), 'Comprobante Fiscal Electrónico');
});

test('ecfFaltaRncCliente: con e-CF, los tipos que identifican al comprador exigen RNC o cédula', () => {
  for (const tipo of ['fiscal', 'gubernamental', 'regimen_especial']) {
    assert.equal(ecfFaltaRncCliente(true, tipo, false), true, `${tipo} sin RNC bloquea`);
    assert.equal(ecfFaltaRncCliente(true, tipo, true), false, `${tipo} con RNC pasa`);
  }
});

test('ecfFaltaRncCliente: el consumo final no necesita RNC', () => {
  assert.equal(ecfFaltaRncCliente(true, 'consumer', false), false);
  assert.equal(ecfFaltaRncCliente(true, 'consumer', true), false);
});

test('ecfFaltaRncCliente: sin e-CF (serie B) nunca bloquea, solo se advierte', () => {
  for (const tipo of ['consumer', 'fiscal', 'gubernamental', 'regimen_especial']) {
    assert.equal(ecfFaltaRncCliente(false, tipo, false), false);
    assert.equal(ecfFaltaRncCliente(false, tipo, true), false);
  }
});

test('documentoVigente: ignora el reemplazado y toma el más reciente de los demás', () => {
  const viejo = doc({ id: 'viejo', createdAt: new Date('2026-11-16T10:00:00Z'), reemplazadoPor: 'nuevo' });
  const nuevo = doc({ id: 'nuevo', createdAt: new Date('2026-11-16T11:00:00Z') });
  assert.equal(documentoVigente([viejo, nuevo])?.id, 'nuevo');
  assert.equal(documentoVigente([nuevo, viejo])?.id, 'nuevo');

  // Entre dos sin reemplazar, el más reciente, en cualquier orden de entrada.
  const a = doc({ id: 'a', createdAt: new Date('2026-11-16T10:00:00Z') });
  const b = doc({ id: 'b', createdAt: new Date('2026-11-17T09:00:00Z') });
  assert.equal(documentoVigente([a, b])?.id, 'b');
  assert.equal(documentoVigente([b, a])?.id, 'b');

  // El más reciente puede ser el reemplazado: no gana por ser el último.
  const reciente = doc({ id: 'reciente', createdAt: new Date('2026-11-18T09:00:00Z'), reemplazadoPor: 'x' });
  assert.equal(documentoVigente([a, reciente])?.id, 'a');
});

test('documentoVigente: sin documentos, o todos reemplazados, no hay vigente', () => {
  assert.equal(documentoVigente([]), undefined);
  assert.equal(documentoVigente([doc({ reemplazadoPor: 'x' })]), undefined);
});

test('documentoVigente: no altera la lista que recibe', () => {
  const lista = [
    doc({ id: 'a', createdAt: new Date('2026-11-16T10:00:00Z') }),
    doc({ id: 'b', createdAt: new Date('2026-11-17T09:00:00Z') }),
  ];
  documentoVigente(lista);
  assert.deepEqual(lista.map((d) => d.id), ['a', 'b']);
});

test('ecfEstadoEtiqueta: texto y tono de cada estado', () => {
  assert.deepEqual(ecfEstadoEtiqueta('rechazado'), { texto: 'Rechazado', tono: 'error' });
  assert.deepEqual(ecfEstadoEtiqueta('por_enviar'), { texto: 'Por enviar', tono: 'espera' });
  assert.deepEqual(ecfEstadoEtiqueta('enviando'), { texto: 'Por enviar', tono: 'espera' });
  assert.deepEqual(ecfEstadoEtiqueta('recibido'), { texto: 'En la DGII', tono: 'espera' });
  assert.deepEqual(ecfEstadoEtiqueta('aceptado'), { texto: 'Aceptado', tono: 'ok' });
  assert.deepEqual(ecfEstadoEtiqueta('aceptado_condicional'), { texto: 'Aceptado con observaciones', tono: 'ok' });
  assert.deepEqual(ecfEstadoEtiqueta('error_datos'), { texto: 'Con error', tono: 'error' });
  assert.deepEqual(ecfEstadoEtiqueta('sin_cupo'), { texto: 'Sin cupo', tono: 'error' });
});

test('ecfEstadoEtiqueta: todo estado tiene etiqueta', () => {
  for (const e of ESTADOS) {
    const etiqueta = ecfEstadoEtiqueta(e);
    assert.ok(etiqueta.texto, `falta el texto de ${e}`);
    assert.ok(['ok', 'espera', 'error'].includes(etiqueta.tono), `tono inválido en ${e}`);
  }
});

test('puedeReintentar: solo error_datos y sin_cupo', () => {
  for (const e of ESTADOS) {
    assert.equal(puedeReintentar(doc({ estado: e })), e === 'error_datos' || e === 'sin_cupo', e);
  }
});

test('puedeReemitir: solo rechazado', () => {
  for (const e of ESTADOS) {
    assert.equal(puedeReemitir(doc({ estado: e })), e === 'rechazado', e);
  }
});

test('ecfConProblema: solo rechazado, error_datos y sin_cupo; sin estado no hay problema', () => {
  for (const e of ESTADOS) {
    assert.equal(ecfConProblema(e), ['rechazado', 'error_datos', 'sin_cupo'].includes(e), e);
  }
  assert.equal(ecfConProblema(undefined), false);
  assert.equal(ecfConProblema(null), false);
});

test('ECF_ESTADOS_CON_PROBLEMA: los mismos que se pueden reintentar o reemitir', () => {
  for (const e of ESTADOS) {
    const resoluble = puedeReintentar(doc({ estado: e })) || puedeReemitir(doc({ estado: e }));
    assert.equal(ECF_ESTADOS_CON_PROBLEMA.includes(e), resoluble, e);
  }
});

test('cuentaComoProblemaEcf: un problema de una venta anulada ya no cuenta', () => {
  for (const e of ESTADOS) {
    assert.equal(cuentaComoProblemaEcf(e, false), ecfConProblema(e), e);
    assert.equal(cuentaComoProblemaEcf(e, true), false, e);
  }
  assert.equal(cuentaComoProblemaEcf(undefined, false), false);
});

test('contarProblemasEcf: cuenta los problemas de ventas vigentes y de notas de crédito, no los de ventas anuladas', () => {
  const filas = [
    { estado: 'rechazado', sales: { cancelled_at: null } },                       // cuenta
    { estado: 'error_datos', sales: { cancelled_at: undefined } },                // cuenta
    { estado: 'sin_cupo', sales: null },                                          // nota de crédito: cuenta
    { estado: 'sin_cupo' },                                                       // sin venta embebida: cuenta
    { estado: 'rechazado', sales: { cancelled_at: '2026-11-20T10:00:00Z' } },     // venta anulada: no
    { estado: 'rechazado', sales: [{ cancelled_at: '2026-11-20T10:00:00Z' }] },   // embed como lista: anulada, no
    { estado: 'rechazado', sales: [{ cancelled_at: null }] },                     // embed como lista: cuenta
    { estado: 'aceptado', sales: { cancelled_at: null } },                        // sin problema: no
    { estado: 'por_enviar', sales: null },                                        // sin problema: no
  ];
  assert.equal(contarProblemasEcf(filas), 5);
  assert.equal(contarProblemasEcf([]), 0);
});

test('resultadoDeEcf: lo que se le dice a quien reintenta, reemite o reimprime', () => {
  // Con problemas manda sobre todo: un rechazado no avanza solo, aunque tenga QR.
  for (const e of ['rechazado', 'error_datos', 'sin_cupo']) {
    assert.equal(resultadoDeEcf(doc({ estado: e })), 'con_problemas', e);
    assert.equal(resultadoDeEcf(doc({ estado: e, qrUrl: 'https://dgii.gov.do/qr' })), 'con_problemas', e);
  }
  // Con QR y sin problemas, listo.
  for (const e of ['aceptado', 'aceptado_condicional', 'recibido']) {
    assert.equal(resultadoDeEcf(doc({ estado: e, qrUrl: 'https://dgii.gov.do/qr' })), 'listo', e);
  }
  // Sin QR, 'se sigue enviando' solo mientras el servidor lo reintenta solo.
  for (const e of ['por_enviar', 'enviando', 'recibido']) {
    assert.equal(resultadoDeEcf(doc({ estado: e })), 'en_proceso', e);
  }
  // No se pudo leer, o aceptado sin QR: no se afirma nada.
  assert.equal(resultadoDeEcf(undefined), 'desconocido');
  assert.equal(resultadoDeEcf(null), 'desconocido');
  assert.equal(resultadoDeEcf(doc({ estado: 'aceptado' })), 'desconocido');
});
