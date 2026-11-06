// Pruebas del seguimiento del estado de los e-CF (consulta en lote a MSeller).
// Nunca se llama a MSeller ni a la base de datos: cada prueba arma dependencias
// falsas en memoria, con un `fetch` falso que guarda las peticiones. `npm test`
// corre `node --test`; Node quita los tipos de estado.ts, por eso ese archivo
// solo puede usar sintaxis borrable.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { consultarPendientes } from '../../supabase/functions/_shared/ecf/estado.ts';

const AHORA = new Date('2026-10-30T12:00:00.000Z');
const minutos = (n) => new Date(AHORA.getTime() + n * 60_000);

// JWT de mentira: solo importa el payload (la firma no se valida).
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.firma`;

const SUB = '3f2a9c1e-8b7d-4e5f-a6b1-0c9d8e7f6a5b';
const ID_TOKEN = jwt({ sub: SUB });
const ID_TOKEN_NUEVO = jwt({ sub: SUB, nuevo: true });
const PASSWORD = 'clave-super-secreta';
const API_KEY = 'api-key-secreta-123';
const REFRESH = 'refresh-secreto-456';
const SECRETOS = [PASSWORD, API_KEY, REFRESH, ID_TOKEN, ID_TOKEN_NUEVO];

const EMPRESA = '00000000-0000-0000-0000-0000000000aa';
const OTRA = '00000000-0000-0000-0000-0000000000bb';
const BASE = 'https://ecf.api.mseller.app/TesteCF';
const LOTE_URL = `${BASE}/documentos-ecf/status/batch`;

const res = (status, cuerpo) =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// `fetch` falso: atiende en orden lo que se le dio y guarda cada llamada.
function fetchFalso(...respuestas) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    llamadas.push({
      url: String(url),
      metodo: init.method,
      headers: new Headers(init.headers),
      cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const r = respuestas.shift();
    if (r === undefined) throw new Error('fetch falso sin respuesta preparada');
    if (r instanceof Error) throw r;
    return r;
  };
  f.llamadas = llamadas;
  f.lotes = () => llamadas.filter((l) => l.metodo === 'POST' && l.url === LOTE_URL);
  f.logins = () => llamadas.filter((l) => l.url.endsWith('/customer/authentication'));
  return f;
}

// Un resultado del lote, tal como lo devuelve MSeller.
const item = (ecf, status, data = {}) => ({ ecf, status, found: true, data: { status, ...data } });
const lote = (...results) => res(200, { total: results.length, results });

// Credenciales con una sesión que sirve (no hace falta iniciar sesión).
const credenciales = (over = {}) => ({
  email: 'caja@ejemplo.com',
  password: PASSWORD,
  apiKey: API_KEY,
  refreshToken: REFRESH,
  sub: SUB,
  idToken: ID_TOKEN,
  idTokenVence: minutos(50).toISOString(),
  ...over,
});

const grupo = (companyId, encfs, over = {}) => ({ companyId, ambiente: 'TesteCF', encfs, ...over });
const encf = (n) => `E32${String(n).padStart(10, '0')}`;

// Dependencias falsas que anotan cada llamada. `over` pisa lo que la prueba necesita.
function armar({ grupos = [], respuestas = [], cred = credenciales(), over = {} } = {}) {
  const reg = {
    leerCredenciales: [],
    guardarSesion: [],
    actualizar: [],
    marcarConsultados: [],
    sumarUso: [],
    avisarSinCupo: [],
  };
  const f = fetchFalso(...respuestas);
  const deps = {
    pendientes: async () => grupos,
    leerCredenciales: async (empresa, ambiente) => {
      reg.leerCredenciales.push([empresa, ambiente]);
      return cred;
    },
    guardarSesion: async (empresa, ambiente, sesion) => {
      reg.guardarSesion.push({ empresa, ambiente, sesion });
    },
    actualizar: async (empresa, e, cambio) => {
      reg.actualizar.push({ empresa, encf: e, cambio });
    },
    marcarConsultados: async (empresa, ambiente, encfs, cuando) => {
      reg.marcarConsultados.push({ empresa, ambiente, encfs, cuando });
    },
    sumarUso: async (empresa, requests, comprobantes) => {
      reg.sumarUso.push([empresa, requests, comprobantes]);
    },
    avisarSinCupo: async (empresa) => {
      reg.avisarSinCupo.push(empresa);
    },
    fetch: f,
    ahora: () => AHORA,
    ...over,
  };
  return { deps, reg, f };
}

// Lo que se le cambió a un documento.
const cambioDe = (reg, e) => {
  const filas = reg.actualizar.filter((a) => a.encf === e);
  assert.equal(filas.length, 1, `se esperaba un solo cambio para ${e}`);
  return filas[0].cambio;
};

// Anota lo que sale por console.warn / console.error mientras corre `fn`.
async function conConsola(fn) {
  const avisos = [];
  const errores = [];
  const w = mock.method(console, 'warn', (...a) => void avisos.push(a.join(' ')));
  const e = mock.method(console, 'error', (...a) => void errores.push(a.join(' ')));
  try {
    await fn();
  } finally {
    w.mock.restore();
    e.mock.restore();
  }
  return { avisos, errores };
}

// ---------------------------------------------------------------------------
// Resultados del lote
// ---------------------------------------------------------------------------

const ENCF_RECHAZADO = 'E310000510916';
const DGII_RECHAZO =
  '{"trackId":"32c4f7e0-dbbe-40cc-a1d4-e4cc0ff82c13","codigo":"2","estado":"Rechazado","rnc":"102320705","encf":"E310000510916","secuenciaUtilizada":true,"fechaRecepcion":"11/3/2025 8:19:30 PM","mensajes":[{"valor":"El campo MontoGravadoTotal del área Totales de la sección Encabezado","codigo":1920}]}';
const MENSAJE_1920 = { codigo: 1920, valor: 'El campo MontoGravadoTotal del área Totales de la sección Encabezado' };

test('rechazado guarda los mensajes', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [ENCF_RECHAZADO])],
    respuestas: [lote(item(ENCF_RECHAZADO, 'Rechazado', { dgiiResponse: [DGII_RECHAZO] }))],
  });
  const r = await consultarPendientes(deps);

  assert.deepEqual(r, { empresas: 1, cambios: 1 });
  assert.equal(reg.actualizar.length, 1);
  assert.equal(reg.actualizar[0].empresa, EMPRESA);
  const c = cambioDe(reg, ENCF_RECHAZADO);
  assert.equal(c.estado, 'rechazado');
  assert.deepEqual(c.mensajes_dgii, [MENSAJE_1920]);
  assert.equal(c.estado_at, AHORA.toISOString(), 'cambió el estado: se pone estado_at');
  assert.equal(c.ultima_consulta_at, AHORA.toISOString());
  // Igual que cuando el rechazo lo ve la emisión: el texto queda en ultimo_error.
  assert.equal(c.ultimo_error, MENSAJE_1920.valor);
});

test('aceptado cambia el estado, deja los mensajes vacíos y cuenta como cambio', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1), encf(2)])],
    respuestas: [lote(item(encf(1), 'Aceptado'), item(encf(2), 'Aceptado Condicional', {
      dgiiResponse: ['{"mensajes":[{"valor":"Observación leve","codigo":7}]}'],
    }))],
  });
  const r = await consultarPendientes(deps);

  assert.deepEqual(r, { empresas: 1, cambios: 2 });
  const a = cambioDe(reg, encf(1));
  assert.equal(a.estado, 'aceptado');
  assert.deepEqual(a.mensajes_dgii, []);
  assert.equal(a.estado_at, AHORA.toISOString());
  assert.ok(!('ultimo_error' in a), 'aceptado no es una falla: no hay ultimo_error');
  const b = cambioDe(reg, encf(2));
  assert.equal(b.estado, 'aceptado_condicional');
  assert.deepEqual(b.mensajes_dgii, [{ codigo: 7, valor: 'Observación leve' }]);
});

test('En Proceso solo marca la consulta', async () => {
  for (const estado of ['En Proceso', 'En Cola', 'Enviado a la DGII']) {
    const { deps, reg } = armar({
      grupos: [grupo(EMPRESA, [encf(1)])],
      respuestas: [lote(item(encf(1), estado))],
    });
    const r = await consultarPendientes(deps);

    assert.deepEqual(r, { empresas: 1, cambios: 0 }, estado);
    assert.deepEqual(cambioDe(reg, encf(1)), { ultima_consulta_at: AHORA.toISOString() }, estado);
  }
});

test('una sola llamada por empresa', async () => {
  const lista = [encf(1), encf(2), encf(3)];
  const { deps, reg, f } = armar({
    grupos: [grupo(EMPRESA, lista)],
    respuestas: [lote(...lista.map((e) => item(e, 'En Proceso')))],
  });
  await consultarPendientes(deps);

  assert.equal(f.llamadas.length, 1);
  const [llamada] = f.lotes();
  assert.equal(llamada.url, LOTE_URL);
  assert.deepEqual(llamada.cuerpo, { ecfs: lista });
  assert.equal(llamada.headers.get('authorization'), `Bearer ${ID_TOKEN}`);
  assert.equal(llamada.headers.get('x-api-key'), API_KEY);
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]]);
  // Los tres e-NCF consultados reciben la marca de consulta.
  assert.deepEqual(reg.actualizar.map((a) => a.encf).sort(), lista);
  assert.ok(reg.actualizar.every((a) => a.cambio.ultima_consulta_at === AHORA.toISOString()));
});

test('no hay nada pendiente: no llama a nadie', async () => {
  const { deps, reg, f } = armar();
  assert.deepEqual(await consultarPendientes(deps), { empresas: 0, cambios: 0 });
  assert.equal(f.llamadas.length, 0);
  assert.equal(reg.actualizar.length, 0);
  assert.equal(reg.sumarUso.length, 0);
});

// ---------------------------------------------------------------------------
// Lo que MSeller no devuelve o no conoce
// ---------------------------------------------------------------------------

test('no_encontrado en un recibido no cambia nada y deja un aviso', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)])],
    respuestas: [lote({ ecf: encf(1), found: false })],
  });
  const { avisos } = await conConsola(async () => {
    const r = await consultarPendientes(deps);
    assert.deepEqual(r, { empresas: 1, cambios: 0 });
  });

  assert.deepEqual(cambioDe(reg, encf(1)), { ultima_consulta_at: AHORA.toISOString() });
  assert.equal(avisos.length, 1);
  assert.ok(avisos[0].includes(encf(1)), 'el aviso nombra el e-NCF');
});

test('un e-NCF que MSeller no devuelve solo recibe la marca de consulta', async () => {
  // Pedimos tres y MSeller contesta dos (y uno que no pedimos).
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1), encf(2), encf(3)])],
    respuestas: [lote(item(encf(1), 'Aceptado'), item(encf(3), 'En Proceso'), item(encf(9), 'Rechazado'))],
  });
  const { avisos } = await conConsola(async () => {
    const r = await consultarPendientes(deps);
    assert.deepEqual(r, { empresas: 1, cambios: 1 });
  });

  assert.equal(cambioDe(reg, encf(1)).estado, 'aceptado');
  assert.deepEqual(cambioDe(reg, encf(2)), { ultima_consulta_at: AHORA.toISOString() });
  assert.deepEqual(cambioDe(reg, encf(3)), { ultima_consulta_at: AHORA.toISOString() });
  assert.ok(!reg.actualizar.some((a) => a.encf === encf(9)), 'lo que no se pidió no se toca');
  assert.equal(avisos.length, 1);
  assert.ok(avisos[0].includes(encf(2)));
});

test('más de 100 e-NCF: se consultan los primeros 100', async () => {
  const lista = Array.from({ length: 101 }, (_, i) => encf(i + 1));
  const { deps, reg, f } = armar({
    grupos: [grupo(EMPRESA, lista)],
    respuestas: [lote(...lista.slice(0, 100).map((e) => item(e, 'En Proceso')))],
  });
  await consultarPendientes(deps);

  assert.equal(f.lotes()[0].cuerpo.ecfs.length, 100);
  assert.equal(reg.actualizar.length, 100);
});

// ---------------------------------------------------------------------------
// Código y QR que faltaron al enviar (R14)
// ---------------------------------------------------------------------------

const QR = 'https://ecf.dgii.gov.do/testecf/consultatimbre?encf=E320000000001&codigoseguridad=fWCZCV';
const DATOS_FIRMA = {
  securityCode: 'fWCZCV',
  qr_url: QR,
  internalTrackId: 'track-1',
  signedDate: '30-10-2026 08:00:01',
};

test('si el recibido no tenía QR y el lote lo trae, se guarda aunque siga en proceso', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)], { sinQr: [encf(1)] })],
    respuestas: [lote(item(encf(1), 'En Proceso', DATOS_FIRMA))],
  });
  await consultarPendientes(deps);

  assert.deepEqual(cambioDe(reg, encf(1)), {
    ultima_consulta_at: AHORA.toISOString(),
    security_code: 'fWCZCV',
    qr_url: QR,
    signed_at: '30-10-2026 08:00:01',
    internal_track_id: 'track-1',
  });
});

test('si además cambió el estado, el QR viaja en el mismo cambio', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)], { sinQr: [encf(1)] })],
    respuestas: [lote(item(encf(1), 'Aceptado', DATOS_FIRMA))],
  });
  await consultarPendientes(deps);

  const c = cambioDe(reg, encf(1));
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.qr_url, QR);
  assert.equal(c.security_code, 'fWCZCV');
});

test('si el documento ya tiene QR, no se vuelve a escribir', async () => {
  const { deps, reg } = armar({
    // encf(1) ya tiene QR (no está en sinQr); encf(2) no.
    grupos: [grupo(EMPRESA, [encf(1), encf(2)], { sinQr: [encf(2)] })],
    respuestas: [lote(item(encf(1), 'En Proceso', DATOS_FIRMA), item(encf(2), 'En Proceso', DATOS_FIRMA))],
  });
  await consultarPendientes(deps);

  assert.deepEqual(cambioDe(reg, encf(1)), { ultima_consulta_at: AHORA.toISOString() });
  assert.equal(cambioDe(reg, encf(2)).qr_url, QR);
});

test('sin QR en la respuesta no se escribe nada de código ni de QR', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)], { sinQr: [encf(1)] })],
    respuestas: [lote(item(encf(1), 'En Proceso'))],
  });
  await consultarPendientes(deps);
  assert.deepEqual(cambioDe(reg, encf(1)), { ultima_consulta_at: AHORA.toISOString() });
});

// ---------------------------------------------------------------------------
// Fallos
// ---------------------------------------------------------------------------

test('429 avisa y sigue con la otra empresa', async () => {
  const { deps, reg, f } = armar({
    grupos: [grupo(EMPRESA, [encf(1)]), grupo(OTRA, [encf(2)])],
    respuestas: [res(429, { message: 'Too Many Requests' }), lote(item(encf(2), 'Aceptado'))],
  });
  const { errores } = await conConsola(async () => {
    const r = await consultarPendientes(deps);
    assert.deepEqual(r, { empresas: 1, cambios: 1 });
  });

  assert.deepEqual(reg.avisarSinCupo, [EMPRESA]);
  assert.equal(f.lotes().length, 2, 'la segunda empresa se consulta igual');
  assert.deepEqual(reg.actualizar.map((a) => [a.empresa, a.encf]), [[OTRA, encf(2)]]);
  // I6: el 429 no es una llamada atendida, no gasta request.
  assert.deepEqual(reg.sumarUso, [[OTRA, 1, 0]]);
  // Pero MSeller contestó: el lote queda marcado y espera el intervalo del plan.
  assert.deepEqual(reg.marcarConsultados, [
    { empresa: EMPRESA, ambiente: 'TesteCF', encfs: [encf(1)], cuando: AHORA.toISOString() },
  ]);
  assert.equal(errores.length, 0, 'el 429 no es un error: ya se avisó');
});

test('un 5xx o un acceso rechazado marcan la consulta; la red no', async () => {
  // 500 en el lote.
  const cinco = armar({ grupos: [grupo(EMPRESA, [encf(1), encf(2)])], respuestas: [res(500, 'caído')] });
  await conConsola(() => consultarPendientes(cinco.deps));
  assert.deepEqual(cinco.reg.marcarConsultados, [
    { empresa: EMPRESA, ambiente: 'TesteCF', encfs: [encf(1), encf(2)], cuando: AHORA.toISOString() },
  ]);
  assert.deepEqual(cinco.reg.actualizar, [], 'no se inventa ningún estado');
  assert.deepEqual(cinco.reg.sumarUso, [[EMPRESA, 1, 0]], 'un 5xx sí es una respuesta: cuenta');

  // El login con la contraseña rechazado.
  const login = armar({
    cred: credenciales({ idToken: null, idTokenVence: null, refreshToken: null }),
    grupos: [grupo(EMPRESA, [encf(1)], { ambiente: 'eCF' })],
    respuestas: [res(401, 'Incorrect username or password.')],
  });
  await conConsola(() => consultarPendientes(login.deps));
  assert.deepEqual(login.reg.marcarConsultados.map((m) => [m.empresa, m.ambiente, m.encfs]), [[EMPRESA, 'eCF', [encf(1)]]]);
  assert.deepEqual(login.reg.sumarUso, [], 'la autenticación no gasta cupo');

  // Sin respuesta: no se sabe si MSeller está ahí; se vuelve a intentar en la próxima pasada.
  const red = armar({ grupos: [grupo(EMPRESA, [encf(1)])], respuestas: [new TypeError('fetch failed')] });
  await conConsola(() => consultarPendientes(red.deps));
  assert.deepEqual(red.reg.marcarConsultados, []);

  // Sin credenciales tampoco hubo respuesta de MSeller.
  const sinCred = armar({
    grupos: [grupo(EMPRESA, [encf(1)])],
    over: {
      leerCredenciales: async () => {
        throw new Error('sin credenciales');
      },
    },
  });
  await conConsola(() => consultarPendientes(sinCred.deps));
  assert.deepEqual(sinCred.reg.marcarConsultados, []);
});

test('si marcar la consulta falla, se registra y se sigue con la otra empresa', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)]), grupo(OTRA, [encf(2)])],
    respuestas: [res(503, 'x'), lote(item(encf(2), 'Aceptado'))],
    over: {
      marcarConsultados: async () => {
        throw new Error('la base no contestó');
      },
    },
  });
  const { errores } = await conConsola(async () => {
    assert.deepEqual(await consultarPendientes(deps), { empresas: 1, cambios: 1 });
  });
  assert.deepEqual(reg.actualizar.map((a) => a.empresa), [OTRA]);
  // Uno por la marca que no se pudo poner y otro por la consulta que falló.
  assert.equal(errores.length, 2);
});

test('si avisar del cupo falla, igual se sigue con la otra empresa', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)]), grupo(OTRA, [encf(2)])],
    respuestas: [res(429, 'x'), lote(item(encf(2), 'En Proceso'))],
    over: {
      avisarSinCupo: async () => {
        throw new Error('la base no contestó');
      },
    },
  });
  const { errores } = await conConsola(async () => {
    assert.deepEqual(await consultarPendientes(deps), { empresas: 1, cambios: 0 });
  });
  assert.equal(reg.actualizar.length, 1);
  assert.equal(errores.length, 1);
});

test('un fallo de red en una empresa no frena a las demás y no gasta cupo', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)]), grupo(OTRA, [encf(2)])],
    respuestas: [new TypeError('fetch failed'), lote(item(encf(2), 'Aceptado'))],
  });
  const { errores } = await conConsola(async () => {
    assert.deepEqual(await consultarPendientes(deps), { empresas: 1, cambios: 1 });
  });

  assert.deepEqual(reg.actualizar.map((a) => a.empresa), [OTRA], 'la que falló queda como estaba');
  assert.deepEqual(reg.sumarUso, [[OTRA, 1, 0]], 'sin respuesta de MSeller no se cuenta ningún request');
  assert.deepEqual(reg.avisarSinCupo, []);
  assert.equal(errores.length, 1);
});

test('sin credenciales guardadas se salta la empresa y sigue', async () => {
  let n = 0;
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1)]), grupo(OTRA, [encf(2)])],
    respuestas: [lote(item(encf(2), 'En Proceso'))],
    over: {
      leerCredenciales: async (empresa) => {
        if (n++ === 0) throw new Error(`La empresa ${empresa} no tiene credenciales`);
        return credenciales();
      },
    },
  });
  const { errores } = await conConsola(async () => {
    assert.deepEqual(await consultarPendientes(deps), { empresas: 1, cambios: 0 });
  });
  assert.deepEqual(reg.actualizar.map((a) => a.empresa), [OTRA]);
  assert.equal(errores.length, 1);
});

test('si falla guardar un documento, los demás se guardan igual', async () => {
  const { deps, reg } = armar({
    grupos: [grupo(EMPRESA, [encf(1), encf(2)])],
    respuestas: [lote(item(encf(1), 'Aceptado'), item(encf(2), 'Aceptado'))],
    over: {
      actualizar: async (empresa, e, cambio) => {
        if (e === encf(1)) throw new Error('la base no contestó');
        reg.actualizar.push({ empresa, encf: e, cambio });
      },
    },
  });
  const { errores } = await conConsola(async () => {
    // Solo cuenta como cambio lo que quedó guardado.
    assert.deepEqual(await consultarPendientes(deps), { empresas: 1, cambios: 1 });
  });
  assert.deepEqual(reg.actualizar.map((a) => a.encf), [encf(2)]);
  assert.equal(errores.length, 1);
  assert.ok(errores[0].includes(encf(1)));
});

test('un error de MSeller no deja secretos en el registro', async () => {
  const { deps } = armar({
    grupos: [grupo(EMPRESA, [encf(1)])],
    // MSeller repite la API key y el token en su error.
    respuestas: [res(500, `falló con ${API_KEY} y ${ID_TOKEN}`)],
  });
  const { errores, avisos } = await conConsola(async () => {
    await consultarPendientes(deps);
  });
  const todo = [...errores, ...avisos].join('\n');
  assert.ok(errores.length >= 1);
  for (const s of SECRETOS) assert.ok(!todo.includes(s), 'un secreto salió en un registro');
});

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

test('con el idToken vencido inicia sesión, la guarda y consulta con el token nuevo', async () => {
  const { deps, reg, f } = armar({
    cred: credenciales({ idToken: ID_TOKEN, idTokenVence: minutos(-5).toISOString(), refreshToken: null }),
    grupos: [grupo(EMPRESA, [encf(1)])],
    respuestas: [res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH }), lote(item(encf(1), 'En Proceso'))],
  });
  await consultarPendientes(deps);

  assert.equal(f.logins().length, 1);
  assert.equal(reg.guardarSesion.length, 1);
  assert.equal(reg.guardarSesion[0].empresa, EMPRESA);
  assert.equal(reg.guardarSesion[0].sesion.idToken, ID_TOKEN_NUEVO);
  assert.equal(f.lotes()[0].headers.get('authorization'), `Bearer ${ID_TOKEN_NUEVO}`);
  // La autenticación no gasta cupo; la consulta sí.
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]]);
});

test('un 401 renueva la sesión y repite la consulta una vez', async () => {
  const { deps, reg, f } = armar({
    grupos: [grupo(EMPRESA, [encf(1)])],
    respuestas: [
      res(401, { message: 'Unauthorized' }),
      res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH }),
      lote(item(encf(1), 'Aceptado')),
    ],
  });
  const r = await consultarPendientes(deps);

  assert.deepEqual(r, { empresas: 1, cambios: 1 });
  assert.equal(f.lotes().length, 2);
  assert.equal(f.lotes()[1].headers.get('authorization'), `Bearer ${ID_TOKEN_NUEVO}`);
  assert.equal(reg.guardarSesion.length, 1);
});

test('dos ambientes de la misma empresa son dos consultas', async () => {
  const { deps, reg, f } = armar({
    grupos: [grupo(EMPRESA, [encf(1)]), grupo(EMPRESA, [encf(2)], { ambiente: 'eCF' })],
    respuestas: [lote(item(encf(1), 'En Proceso')), lote(item(encf(2), 'En Proceso'))],
  });
  const r = await consultarPendientes(deps);

  assert.deepEqual(r, { empresas: 1, cambios: 0 }, 'es la misma empresa');
  assert.deepEqual(f.llamadas.map((l) => l.url), [LOTE_URL, 'https://ecf.api.mseller.app/eCF/documentos-ecf/status/batch']);
  assert.deepEqual(reg.leerCredenciales, [[EMPRESA, 'TesteCF'], [EMPRESA, 'eCF']]);
});
