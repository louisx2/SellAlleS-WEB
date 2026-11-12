// Pruebas de la regla de la memoria de consultas de RNC
// (supabase/functions/_shared/dgii/consulta.ts): cuándo se devuelve lo guardado,
// cuándo se pregunta a la DGII y qué pasa si la DGII o la base fallan. Todo con
// dependencias falsas: ni DGII ni base.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  consultarRnc,
  DIAS_MEMORIA,
  DIAS_MEMORIA_NO_ENCONTRADO,
} from '../../supabase/functions/_shared/dgii/consulta.ts';
import { ErrorDgii } from '../../supabase/functions/_shared/dgii/rnc.ts';

const AHORA = new Date('2026-11-12T12:00:00.000Z');
const haceHoras = (h) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
const haceDias = (d) => haceHoras(d * 24);

const DATOS = {
  rnc: '130862346',
  razonSocial: 'IT SOLUCLICK SRL',
  nombreComercial: 'IT SOLUCLICK',
  categoria: '',
  regimenPagos: 'NORMAL',
  estado: 'ACTIVO',
  actividadEconomica: 'DISEÑO Y DESARROLLO DE SOFTWARE',
  administracionLocal: 'ADM LOCAL ABRAHAM LINCOLN',
  facturadorElectronico: true,
};
const NUEVOS = { ...DATOS, estado: 'SUSPENDIDO' };

// `memoria`: lo que devuelve leerMemoria; `dgii`: lo que devuelve consultarDgii (o el error que lanza).
function armar({ memoria = null, dgii = { encontrado: true, datos: NUEVOS }, over = {} } = {}) {
  const reg = { leidas: [], guardadas: [], consultas: [], registro: [] };
  const deps = {
    leerMemoria: async (rnc) => {
      reg.leidas.push(rnc);
      return memoria;
    },
    guardarMemoria: async (fila) => {
      reg.guardadas.push(fila);
    },
    consultarDgii: async (rnc) => {
      reg.consultas.push(rnc);
      if (dgii instanceof Error) throw dgii;
      return dgii;
    },
    ahora: () => AHORA,
    registrar: (t) => reg.registro.push(t),
    ...over,
  };
  return { deps, reg };
}

test('la memoria dura 30 días si se encontró y 1 día si no', () => {
  assert.equal(DIAS_MEMORIA, 30);
  assert.equal(DIAS_MEMORIA_NO_ENCONTRADO, 1);
});

test('un documento que no pasa el verificador no toca ni la memoria ni la DGII', async () => {
  for (const texto of ['130862347', '1234', '', '402-1234567-9']) {
    const { deps, reg } = armar();
    assert.deepEqual(await consultarRnc(texto, deps), { ok: false, motivo: 'documento_invalido' });
    assert.deepEqual(reg.leidas, []);
    assert.deepEqual(reg.consultas, []);
  }
});

test('con memoria de 29 días devuelve lo guardado sin preguntar a la DGII', async () => {
  const memoria = { rnc: '130862346', encontrado: true, datos: DATOS, consultadoAt: haceDias(29) };
  const { deps, reg } = armar({ memoria });
  const r = await consultarRnc('130-86234-6', deps);

  assert.deepEqual(r, { ok: true, encontrado: true, datos: DATOS, consultadoAt: memoria.consultadoAt, desactualizado: false });
  assert.deepEqual(reg.leidas, ['130862346'], 'busca por los dígitos');
  assert.deepEqual(reg.consultas, []);
});

test('con memoria de 31 días pregunta a la DGII, guarda y devuelve lo nuevo', async () => {
  const memoria = { rnc: '130862346', encontrado: true, datos: DATOS, consultadoAt: haceDias(31) };
  const { deps, reg } = armar({ memoria });
  const r = await consultarRnc('130862346', deps);

  assert.deepEqual(r, { ok: true, encontrado: true, datos: NUEVOS, consultadoAt: AHORA.toISOString(), desactualizado: false });
  assert.deepEqual(reg.consultas, ['130862346']);
  assert.deepEqual(reg.guardadas, [{ rnc: '130862346', encontrado: true, datos: NUEVOS, consultadoAt: AHORA.toISOString() }]);
});

test('un "no encontrado" vale 1 día: a las 12 horas no pregunta, a las 25 sí', async () => {
  const fresca = armar({ memoria: { rnc: '199999991', encontrado: false, datos: null, consultadoAt: haceHoras(12) } });
  assert.deepEqual(await consultarRnc('199999991', fresca.deps), { ok: true, encontrado: false });
  assert.deepEqual(fresca.reg.consultas, []);

  const vieja = armar({
    memoria: { rnc: '199999991', encontrado: false, datos: null, consultadoAt: haceHoras(25) },
    dgii: { encontrado: false },
  });
  assert.deepEqual(await consultarRnc('199999991', vieja.deps), { ok: true, encontrado: false });
  assert.deepEqual(vieja.reg.consultas, ['199999991']);
  assert.deepEqual(vieja.reg.guardadas, [{ rnc: '199999991', encontrado: false, datos: null, consultadoAt: AHORA.toISOString() }]);
});

test('sin memoria pregunta a la DGII y guarda', async () => {
  const { deps, reg } = armar();
  const r = await consultarRnc('130862346', deps);
  assert.equal(r.ok, true);
  assert.equal(r.encontrado, true);
  assert.equal(reg.guardadas.length, 1);
});

test('si la DGII falla y hay un dato viejo, lo devuelve marcado como desactualizado', async () => {
  const memoria = { rnc: '130862346', encontrado: true, datos: DATOS, consultadoAt: haceDias(40) };
  const { deps, reg } = armar({ memoria, dgii: new ErrorDgii('La DGII respondió 503.') });
  const r = await consultarRnc('130862346', deps);

  assert.deepEqual(r, { ok: true, encontrado: true, datos: DATOS, consultadoAt: memoria.consultadoAt, desactualizado: true });
  assert.deepEqual(reg.guardadas, []);
  assert.equal(reg.registro.length, 1);
});

test('si la DGII falla y no hay dato, responde dgii_no_responde', async () => {
  for (const memoria of [null, { rnc: '199999991', encontrado: false, datos: null, consultadoAt: haceDias(3) }]) {
    const { deps } = armar({ memoria, dgii: new ErrorDgii('Sin respuesta de la DGII.') });
    assert.deepEqual(await consultarRnc('199999991', deps), { ok: false, motivo: 'dgii_no_responde' });
  }
  // Un error que no es de la DGII (un fallo nuestro) tampoco sale como excepción.
  const { deps } = armar({ dgii: new TypeError('x is undefined') });
  assert.deepEqual(await consultarRnc('130862346', deps), { ok: false, motivo: 'dgii_no_responde' });
});

test('si la base falla al leer o al guardar, la consulta sigue y el error va al registro', async () => {
  const { deps, reg } = armar({
    over: {
      leerMemoria: async () => {
        throw new Error('relation "dgii_contribuyentes" does not exist');
      },
      guardarMemoria: async () => {
        throw new Error('permission denied');
      },
    },
  });
  const r = await consultarRnc('130862346', deps);
  assert.equal(r.ok, true);
  assert.equal(r.encontrado, true);
  assert.deepEqual(reg.consultas, ['130862346']);
  assert.equal(reg.registro.length, 2);
});
