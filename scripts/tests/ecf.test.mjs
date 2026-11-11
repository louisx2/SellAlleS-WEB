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
  TIPO_PREFIX_E,
  formatearNcf,
  fechaDMA,
  diasParaVencer,
  certificadoPorVencer,
  avisoSerieB,
  secuenciaExigeVencimiento,
  SECUENCIA_E_MAXIMA,
  porcentajeDeUso,
  cupoPorAgotarse,
  mayorUsoDeCupo,
  CUPO_AVISO_PCT,
  ECF_QR_ATRIBUTO,
  esperarQrEcf,
  avisoNotaAlAnular,
  avisoPruebaSinMarca,
} from '../../src/lib/ecf.ts';
import { PLANES_MSELLER } from '../../src/lib/ecf-planes.ts';

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

test('TIPO_PREFIX_E: los seis prefijos que acepta ncf_sequences_prefijo_e_check, y ninguno más', () => {
  assert.deepEqual(TIPO_PREFIX_E, {
    consumer: 'E32',
    fiscal: 'E31',
    nota_credito: 'E34',
    nota_debito: 'E33',
    regimen_especial: 'E44',
    gubernamental: 'E45',
  });
  // Cada prefijo es E + el tipo de ECF_NOMBRE: si uno se sale del catálogo, aquí se nota.
  for (const prefijo of Object.values(TIPO_PREFIX_E)) {
    assert.ok(ECF_NOMBRE[Number(prefijo.slice(1))], prefijo);
  }
});

test('formatearNcf: 10 dígitos en la serie E, 8 en la B', () => {
  assert.equal(formatearNcf('E32', 1, true), 'E320000000001');
  assert.equal(formatearNcf('E31', 250, true), 'E310000000250');
  assert.equal(formatearNcf('B02', 1, false), 'B0200000001');
  assert.equal(formatearNcf('B01', 500, false), 'B0100000500');
  // Lo que arma para una E es un e-NCF válido.
  assert.equal(esEcf(formatearNcf('E34', 7, true)), true);
  // Sin prefijo no sale "null" ni "undefined".
  assert.equal(formatearNcf(null, 3, false), '00000003');
  assert.equal(formatearNcf(undefined, 3, true), '0000000003');
});

test('fechaDMA: AAAA-MM-DD a DD/MM/AAAA sin correr el día', () => {
  assert.equal(fechaDMA('2026-11-15'), '15/11/2026');
  assert.equal(fechaDMA('2027-01-01'), '01/01/2027');
});

test('diasParaVencer: días de calendario entre hoy y el vencimiento', () => {
  assert.equal(diasParaVencer('2026-11-30', '2026-11-30'), 0);
  assert.equal(diasParaVencer('2026-12-30', '2026-11-30'), 30);
  assert.equal(diasParaVencer('2026-12-01', '2026-11-30'), 1);
  // Vencido: negativo.
  assert.equal(diasParaVencer('2026-11-29', '2026-11-30'), -1);
  // Cruza fin de año y año bisiesto.
  assert.equal(diasParaVencer('2027-01-05', '2026-12-30'), 6);
  assert.equal(diasParaVencer('2028-03-01', '2028-02-28'), 2);
  // Sin fecha no hay cuenta.
  assert.equal(diasParaVencer(null, '2026-11-30'), null);
  assert.equal(diasParaVencer(undefined, '2026-11-30'), null);
  assert.equal(diasParaVencer('', '2026-11-30'), null);
});

test('certificadoPorVencer: en rojo a 30 días o menos, vencido incluido', () => {
  const hoy = '2026-11-30';
  assert.equal(certificadoPorVencer('2027-06-01', hoy), false);
  assert.equal(certificadoPorVencer('2026-12-31', hoy), false); // faltan 31
  assert.equal(certificadoPorVencer('2026-12-30', hoy), true);  // faltan 30
  assert.equal(certificadoPorVencer('2026-12-01', hoy), true);
  assert.equal(certificadoPorVencer('2026-11-30', hoy), true);  // vence hoy
  assert.equal(certificadoPorVencer('2026-10-01', hoy), true);  // ya venció
  // Sin fecha (la empresa aún no tiene certificado cargado): nada que avisar.
  assert.equal(certificadoPorVencer(null, hoy), false);
  assert.equal(certificadoPorVencer(undefined, hoy), false);
});

test('avisoSerieB: el mismo texto del error de assign_ncf, con la fecha en DD/MM/AAAA', () => {
  assert.equal(
    avisoSerieB('2026-11-15'),
    'La serie B dejó de ser válida el 15/11/2026. Para emitir comprobantes hay que activar la facturación electrónica.',
  );
  // Sin la fecha de corte, la misma frase sin fecha.
  assert.equal(
    avisoSerieB(null),
    'La serie B dejó de ser válida. Para emitir comprobantes hay que activar la facturación electrónica.',
  );
  // Sin decir nada del e-CF es lo mismo que sin e-CF.
  assert.equal(avisoSerieB('2026-11-15', false), avisoSerieB('2026-11-15'));
});

test('avisoSerieB con e-CF activo: solo que las secuencias nuevas son E (I2)', () => {
  assert.equal(
    avisoSerieB('2026-11-15', true),
    'La serie B dejó de ser válida el 15/11/2026. Las secuencias nuevas son E.',
  );
  assert.equal(avisoSerieB(null, true), 'La serie B ya no es válida. Las secuencias nuevas son E.');
  assert.equal(avisoSerieB(undefined, true), 'La serie B ya no es válida. Las secuencias nuevas son E.');
  assert.ok(!avisoSerieB('2026-11-15', true).includes('activar'), 'la empresa ya tiene la facturación electrónica');
});

test('secuenciaExigeVencimiento: en la serie E todos menos E32 y E34; en la B ninguno (I4)', () => {
  for (const tipo of ['fiscal', 'nota_debito', 'regimen_especial', 'gubernamental']) {
    assert.equal(secuenciaExigeVencimiento(true, tipo), true, tipo);
    assert.equal(secuenciaExigeVencimiento(false, tipo), false, `${tipo} en B`);
  }
  for (const tipo of ['consumer', 'nota_credito']) {
    assert.equal(secuenciaExigeVencimiento(true, tipo), false, tipo);
    assert.equal(secuenciaExigeVencimiento(false, tipo), false, `${tipo} en B`);
  }
  assert.equal(SECUENCIA_E_MAXIMA, 9999999999);
});

test('PLANES_MSELLER: cupos de cada plan y minutos entre consultas', () => {
  assert.deepEqual(PLANES_MSELLER.emprende, { nombre: 'Emprende', comprobantes: 500, requests: 2000, minutos: 30 });
  // El plan gratis consulta cada hora; los de pago, cada 30 minutos.
  assert.equal(PLANES_MSELLER.gratis.minutos, 60);
  for (const plan of ['emprende', 'basico', 'negocio', 'avanzado', 'empresa']) {
    assert.equal(PLANES_MSELLER[plan].minutos, 30, plan);
  }
  // Los seis planes que acepta ecf_config_plan_check, con los cupos de MSeller.
  assert.deepEqual(
    Object.entries(PLANES_MSELLER).map(([k, p]) => [k, p.comprobantes, p.requests]),
    [
      ['gratis', 250, 1000],
      ['emprende', 500, 2000],
      ['basico', 1000, 4000],
      ['negocio', 2500, 10000],
      ['avanzado', 6000, 24000],
      ['empresa', 10000, 100000],
    ],
  );
});

test('porcentajeDeUso: uso sobre el cupo, sin redondear y sin dividir entre cero', () => {
  assert.equal(porcentajeDeUso(0, 250), 0);
  assert.equal(porcentajeDeUso(200, 250), 80);
  assert.equal(porcentajeDeUso(250, 250), 100);
  assert.equal(porcentajeDeUso(300, 250), 120); // pasado del cupo
  assert.ok(Math.abs(porcentajeDeUso(199, 250) - 79.6) < 1e-9);
  // Cupo en 0: con uso está agotado, sin uso no hay nada que avisar.
  assert.equal(porcentajeDeUso(1, 0), 100);
  assert.equal(porcentajeDeUso(0, 0), 0);
});

test('cupoPorAgotarse: rojo desde el 80 %, ni un poco antes', () => {
  assert.equal(cupoPorAgotarse(CUPO_AVISO_PCT), true);
  assert.equal(cupoPorAgotarse(80), true);
  assert.equal(cupoPorAgotarse(79.99), false);
  assert.equal(cupoPorAgotarse(porcentajeDeUso(199, 250)), false); // 79,6 %
  assert.equal(cupoPorAgotarse(porcentajeDeUso(200, 250)), true);   // 80 %
});

test('mayorUsoDeCupo: manda el más lleno de los dos cupos', () => {
  // Comprobantes al 10 %, requests al 90 %: el resumen ordena por el 90.
  assert.equal(mayorUsoDeCupo(25, 250, 900, 1000), 90);
  // Al revés.
  assert.equal(mayorUsoDeCupo(225, 250, 100, 1000), 90);
  assert.equal(mayorUsoDeCupo(0, 250, 0, 1000), 0);
  // Ordenar por él deja arriba a la empresa más apretada.
  const filas = [
    { e: 'A', u: mayorUsoDeCupo(10, 250, 100, 1000) },
    { e: 'B', u: mayorUsoDeCupo(240, 250, 100, 1000) },
    { e: 'C', u: mayorUsoDeCupo(10, 250, 850, 1000) },
  ];
  assert.deepEqual(filas.sort((a, b) => b.u - a.u).map((f) => f.e), ['B', 'C', 'A']);
});

// Raíz falsa: responde al selector del QR pendiente mientras le queden vueltas.
const raizConQrPendiente = (vueltas) => {
  const vistos = [];
  return {
    vistos,
    querySelector(sel) {
      vistos.push(sel);
      return vueltas-- > 0 ? {} : null;
    },
  };
};

test('esperarQrEcf: sin QR pendiente sigue al instante', async () => {
  const raiz = raizConQrPendiente(0);
  assert.equal(await esperarQrEcf(raiz, 1000, 1), true);
  // Busca exactamente el atributo que pone ReceiptEcf mientras dibuja el QR.
  assert.deepEqual(raiz.vistos, [`[${ECF_QR_ATRIBUTO}="cargando"]`]);
});

test('esperarQrEcf: espera a que el QR termine de dibujarse', async () => {
  const raiz = raizConQrPendiente(3);
  assert.equal(await esperarQrEcf(raiz, 1000, 1), true);
  assert.equal(raiz.vistos.length, 4);
});

test('esperarQrEcf: no se queda colgado si el QR nunca llega', async () => {
  const raiz = raizConQrPendiente(Infinity);
  const inicio = Date.now();
  assert.equal(await esperarQrEcf(raiz, 30, 5), false);
  assert.ok(Date.now() - inicio < 500);
});

test('esperarQrEcf: sin raíz no espera', async () => {
  assert.equal(await esperarQrEcf(null, 1000, 1), true);
  assert.equal(await esperarQrEcf(undefined, 1000, 1), true);
});

test('avisoNotaAlAnular: sigue al NCF de la venta, como annul_sale', () => {
  // Sin comprobante no hay nota de crédito.
  assert.equal(avisoNotaAlAnular(null, undefined), '');
  assert.equal(avisoNotaAlAnular('', undefined), '');
  // Venta con B: B04, aunque la empresa haya apagado los NCF después.
  assert.match(avisoNotaAlAnular('B0200000012', undefined), /B04/);
  // e-CF: E34, aunque companies.ncf_enabled esté apagado (el e-CF no depende de él).
  assert.match(avisoNotaAlAnular('E320000000012', 'aceptado'), /E34/);
  assert.match(avisoNotaAlAnular('E310000000012', 'recibido'), /E34/);
  // Rechazado: la DGII nunca lo aceptó y se anula sin nota.
  assert.equal(avisoNotaAlAnular('E320000000012', 'rechazado'), '');
});

test('avisoPruebaSinMarca: dice qué falta para que la conexión quede marcada', () => {
  // Sin datos del emisor guardados (la empresa no tiene fila en ecf_config).
  const sinDatos = avisoPruebaSinMarca('TesteCF', null);
  assert.match(sinDatos.titulo, /funcionan/);
  assert.match(sinDatos.descripcion, /datos del emisor/);
  assert.doesNotMatch(sinDatos.descripcion, /ambiente en uso/);

  // Credenciales de otro ambiente que el de la empresa.
  const otro = avisoPruebaSinMarca('TesteCF', 'eCF');
  assert.match(otro.descripcion, /Pruebas \(TesteCF\)/);
  assert.match(otro.descripcion, /Producción \(eCF\)/);
  assert.doesNotMatch(otro.descripcion, /datos del emisor/);

  // Mismo ambiente y aun así sin marcar: no debería pasar; se pide reintentar.
  assert.match(avisoPruebaSinMarca('TesteCF', 'TesteCF').descripcion, /vuelve a probar/);
});
