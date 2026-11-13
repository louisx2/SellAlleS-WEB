// Pruebas de lo que hace `ecf-admin` con las credenciales de MSeller: guardarlas,
// probar la conexión y limpiar de secretos todo lo que sale hacia el navegador o
// el registro. Nunca se llama a MSeller ni a la base: cada prueba usa un cliente
// de Supabase falso y un `fetch` falso que guardan lo que reciben. `npm test` corre
// `node --test`; Node quita los tipos de admin.ts, por eso ese archivo solo puede
// usar sintaxis borrable. La autorización (sesión y super admin) vive en
// ecf-admin/index.ts, bajo Deno, y no se prueba aquí.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  administrar,
  ENCF_DE_PRUEBA,
  ERROR_INTERNO,
  guardarCredenciales,
  motivoDe,
  ocultar,
  probarConexion,
} from '../../supabase/functions/_shared/ecf/admin.ts';
import { MsellerError } from '../../supabase/functions/_shared/ecf/mseller.ts';

const AHORA = new Date('2026-10-30T12:00:00.000Z');
const EMPRESA = '00000000-0000-0000-0000-0000000000aa';
const LOGIN_URL = 'https://ecf.api.mseller.app/TesteCF/customer/authentication';

// JWT de mentira: solo importa el payload (la firma no se valida).
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.firma`;

const SUB = '3f2a9c1e-8b7d-4e5f-a6b1-0c9d8e7f6a5b';
const EMAIL = 'ecf+demo@sellalles.com';
const PASSWORD = 'clave-super-secreta';
const API_KEY = 'api-key-secreta-123';
const REFRESH_VIEJO = 'refresh-viejo-456';
const ID_TOKEN_VIEJO = jwt({ sub: SUB, viejo: true });
const REFRESH_NUEVO = 'refresh-nuevo-789';
const ID_TOKEN_NUEVO = jwt({ sub: SUB, nuevo: true });
const SECRETOS = [PASSWORD, API_KEY, REFRESH_VIEJO, ID_TOKEN_VIEJO, REFRESH_NUEVO, ID_TOKEN_NUEVO];

const sinSecretos = (texto) => SECRETOS.every((s) => !String(texto).includes(s));

// Lo que devuelve ecf_leer_credenciales: con una sesión guardada que TODAVÍA sirve
// (vence en 50 minutos) y un refresh token, para ver que la prueba no las reutiliza.
const CREDENCIALES = {
  email: EMAIL,
  password: PASSWORD,
  api_key: API_KEY,
  refresh_token: REFRESH_VIEJO,
  sub: SUB,
  id_token: ID_TOKEN_VIEJO,
  id_token_vence: '2026-10-30T12:50:00.000Z',
};

const res = (status, cuerpo) =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const loginOk = () => res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH_NUEVO });
// La consulta de prueba de la API key: MSeller no conoce ese e-NCF.
const noEncontrado = () => res(404, { message: 'Documento no encontrado' });
const CONSULTA_URL = `https://ecf.api.mseller.app/TesteCF/documentos-ecf?ecf=${ENCF_DE_PRUEBA}`;

// `fetch` falso: atiende en orden lo que se le dio y guarda cada llamada.
function fetchFalso(...respuestas) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    llamadas.push({
      url: String(url),
      metodo: init.method,
      encabezados: init.headers,
      cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const r = respuestas.shift();
    if (r === undefined) throw new Error('fetch falso sin respuesta preparada');
    if (r instanceof Error) throw r;
    return r;
  };
  f.llamadas = llamadas;
  return f;
}

// Cliente de Supabase falso: guarda las RPC y las consultas por tabla.
//   rpcs:    respuesta de cada RPC (por defecto { data: null, error: null });
//   filas:   las filas que devuelve el update de ecf_config;
//   empresa: lo que devuelve la búsqueda en companies.
function dbFalso({
  credenciales = CREDENCIALES,
  rpcs = {},
  filas = [{ company_id: EMPRESA }],
  errorUpdate = null,
  empresa = { id: EMPRESA },
  errorEmpresa = null,
} = {}) {
  const rpc = [];
  const from = [];
  const client = {
    rpc: async (fn, args) => {
      rpc.push({ fn, args });
      if (fn === 'ecf_leer_credenciales') return { data: credenciales, error: null };
      return rpcs[fn] ?? { data: null, error: null };
    },
    from: (tabla) => {
      const reg = { tabla, filtros: [] };
      from.push(reg);
      const b = {
        update(valores) {
          reg.update = valores;
          return b;
        },
        eq(col, val) {
          reg.filtros.push([col, val]);
          return b;
        },
        select(cols) {
          reg.select = cols;
          // El update de ecf_config termina aquí; la búsqueda de la empresa sigue con maybeSingle.
          return reg.update ? Promise.resolve({ data: filas, error: errorUpdate }) : b;
        },
        maybeSingle: async () => ({ data: empresa, error: errorEmpresa }),
      };
      return b;
    },
  };
  return { client, rpc, from };
}

// Dependencias de ecf-admin; `registro` junta lo que iría al registro de la función.
function deps(f) {
  const registro = [];
  return { fetch: f, ahora: () => AHORA, registrar: (t) => registro.push(t), registro };
}

// ---------------------------------------------------------------------------
// probarConexion
// ---------------------------------------------------------------------------

test('probar_conexion inicia sesión con la contraseña aunque haya un idToken vigente y un refresh token guardados', async () => {
  const f = fetchFalso(loginOk(), noEncontrado());
  const d = dbFalso();
  const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(f));

  assert.deepEqual(r, { ok: true, marcada: true });
  // R3: el login con correo y contraseña, nunca la renovación con el refresh
  // token; después, la consulta que prueba la API key.
  assert.equal(f.llamadas.length, 2);
  assert.equal(f.llamadas[0].url, LOGIN_URL);
  assert.equal(f.llamadas[0].metodo, 'POST');
  assert.deepEqual(f.llamadas[0].cuerpo, { email: EMAIL, password: PASSWORD });
});

test('probar_conexion guarda la sesión nueva y marca la conexión como probada del ambiente de la empresa', async () => {
  const d = dbFalso();
  await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), noEncontrado())));

  assert.deepEqual(d.rpc.map((x) => x.fn), ['ecf_leer_credenciales', 'ecf_guardar_sesion', 'ecf_sumar_uso']);
  assert.deepEqual(d.rpc[0].args, { p_company: EMPRESA, p_ambiente: 'TesteCF' });
  assert.deepEqual(d.rpc[1].args, {
    p_company: EMPRESA,
    p_ambiente: 'TesteCF',
    p_id_token: ID_TOKEN_NUEVO,
    p_id_token_vence: '2026-10-30T12:55:00.000Z',
    p_refresh_token: REFRESH_NUEVO,
    p_sub: SUB,
  });

  assert.equal(d.from.length, 1);
  assert.equal(d.from[0].tabla, 'ecf_config');
  assert.deepEqual(d.from[0].update, { conexion_probada_at: AHORA.toISOString() });
  assert.deepEqual(d.from[0].filtros, [['company_id', EMPRESA], ['ambiente', 'TesteCF']]);
});

test('probar_conexion: si el update no toca ninguna fila (otro ambiente o sin ecf_config) responde ok con marcada:false', async () => {
  const d = dbFalso({ filas: [] });
  const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), noEncontrado())));
  assert.deepEqual(r, { ok: true, marcada: false });
  // Sí intentó marcar, y solo el ambiente que se probó.
  assert.deepEqual(d.from[0].filtros, [['company_id', EMPRESA], ['ambiente', 'TesteCF']]);
});

test('probar_conexion: si el inicio de sesión falla no guarda la sesión ni toca ecf_config', async () => {
  for (const respuesta of [res(401, 'no autorizado'), res(400, 'datos malos'), res(500, 'caído'), new Error('sin red')]) {
    const d = dbFalso();
    const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(respuesta)));
    assert.equal(r.ok, false);
    assert.deepEqual(d.rpc.map((x) => x.fn), ['ecf_leer_credenciales']);
    assert.equal(d.from.length, 0, 'no debía intentar marcar la conexión');
  }
});

test('probar_conexion: el error de MSeller sale en español y sin los secretos que MSeller devuelva en su cuerpo', async () => {
  const eco = `Credenciales inválidas para ${EMAIL}: password ${PASSWORD}, key ${API_KEY}, refresh ${REFRESH_VIEJO}, token ${ID_TOKEN_VIEJO}`;
  for (const status of [400, 422]) {
    const r = await probarConexion(dbFalso().client, EMPRESA, 'TesteCF', deps(fetchFalso(res(status, eco))));
    assert.equal(r.ok, false);
    assert.ok(r.error.startsWith('MSeller no aceptó el inicio de sesión: '), r.error);
    assert.ok(r.error.includes('***'), 'debía quedar el rastro del texto limpiado');
    assert.ok(sinSecretos(r.error), `el error dejó salir un secreto: ${r.error}`);
    assert.ok(r.error.includes(EMAIL), 'el correo no es un secreto y ayuda a entender el error');
  }
  for (const status of [401, 403, 429, 502]) {
    const r = await probarConexion(dbFalso().client, EMPRESA, 'TesteCF', deps(fetchFalso(res(status, eco))));
    assert.equal(r.ok, false);
    assert.match(r.error, /MSeller/);
    assert.ok(!r.error.startsWith('MSeller no aceptó'), 'solo los 400/422 llevan esa aclaración');
    assert.ok(sinSecretos(r.error), `el error ${status} dejó salir un secreto: ${r.error}`);
  }
  // También si la caída de red lleva algún secreto en su descripción.
  const caida = await probarConexion(
    dbFalso().client,
    EMPRESA,
    'TesteCF',
    deps(fetchFalso(new Error(`ECONNRESET con password ${PASSWORD} y key ${API_KEY}`))),
  );
  assert.equal(caida.ok, false);
  assert.ok(caida.error.startsWith('Sin respuesta de MSeller'), caida.error);
  assert.ok(sinSecretos(caida.error), caida.error);
});

test('probar_conexion: un fallo de MSeller es un resultado esperado y no va al registro', async () => {
  const d = deps(fetchFalso(res(401, 'no')));
  await probarConexion(dbFalso().client, EMPRESA, 'TesteCF', d);
  assert.deepEqual(d.registro, []);
});

test('probar_conexion: sin credenciales guardadas responde ok:false sin llamar a MSeller', async () => {
  const f = fetchFalso();
  const d = deps(f);
  for (const credenciales of [null, { ...CREDENCIALES, api_key: null }]) {
    const r = await probarConexion(dbFalso({ credenciales }).client, EMPRESA, 'TesteCF', d);
    assert.equal(r.ok, false);
    assert.match(r.error, /credenciales de MSeller/);
    assert.ok(sinSecretos(r.error));
  }
  assert.equal(f.llamadas.length, 0);
});

test('probar_conexion: si la base falla al guardar la sesión responde ok:false sin secretos y lo deja en el registro limpio', async () => {
  // El mensaje de la base repite todo lo que se le mandó: las credenciales que ya se leyeron y los tokens nuevos.
  const eco = `violación con ${PASSWORD} ${API_KEY} ${REFRESH_VIEJO} ${ID_TOKEN_VIEJO} ${ID_TOKEN_NUEVO} ${REFRESH_NUEVO}`;
  const d = dbFalso({ rpcs: { ecf_guardar_sesion: { data: null, error: { message: eco } } } });
  const dep = deps(fetchFalso(loginOk()));
  const r = await probarConexion(d.client, EMPRESA, 'TesteCF', dep);

  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith('No se pudo guardar la sesión de MSeller: violación con ***'), r.error);
  assert.ok(sinSecretos(r.error), `el error dejó salir un secreto: ${r.error}`);
  assert.equal(d.from.length, 0, 'sin sesión guardada no debía marcar la conexión');
  assert.equal(dep.registro.length, 1);
  assert.ok(dep.registro[0].startsWith('ecf-admin: probar_conexion: '), dep.registro[0]);
  assert.ok(sinSecretos(dep.registro[0]), `el registro dejó salir un secreto: ${dep.registro[0]}`);
});

test('probar_conexion: si la base falla al marcar la conexión responde ok:false sin los tokens nuevos', async () => {
  const d = dbFalso({
    errorUpdate: { message: `fila rechazada: ${ID_TOKEN_NUEVO} / ${REFRESH_NUEVO} / ${PASSWORD}` },
  });
  const dep = deps(fetchFalso(loginOk(), noEncontrado()));
  const r = await probarConexion(d.client, EMPRESA, 'TesteCF', dep);

  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith('No se pudo marcar la conexión como probada: fila rechazada: ***'), r.error);
  assert.ok(sinSecretos(r.error), r.error);
  assert.equal(dep.registro.length, 1);
  assert.ok(sinSecretos(dep.registro[0]), dep.registro[0]);
});

test('probar_conexion: si la base falla al leer las credenciales responde ok:false con un mensaje fijo', async () => {
  const d = dbFalso();
  d.client.rpc = async () => ({ data: null, error: { message: 'boom' } });
  const f = fetchFalso();
  const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(f));
  assert.deepEqual(r, { ok: false, error: 'No se pudieron leer las credenciales de MSeller: boom' });
  assert.equal(f.llamadas.length, 0);
});

// ---------------------------------------------------------------------------
// probarConexion: la API key
// ---------------------------------------------------------------------------

test('probar_conexion prueba la API key con una consulta de un e-NCF que no existe, con la sesión nueva', async () => {
  const f = fetchFalso(loginOk(), noEncontrado());
  await probarConexion(dbFalso().client, EMPRESA, 'TesteCF', deps(f));

  const consulta = f.llamadas[1];
  assert.equal(consulta.url, CONSULTA_URL);
  assert.equal(consulta.metodo, 'GET');
  assert.equal(consulta.encabezados['X-API-KEY'], API_KEY);
  assert.equal(consulta.encabezados.Authorization, `Bearer ${ID_TOKEN_NUEVO}`);
  // El login no lleva la API key: por eso hace falta la consulta.
  assert.equal(f.llamadas[0].encabezados['X-API-KEY'], undefined);
});

test('probar_conexion: si MSeller rechaza la API key no marca la conexión y lo dice claro, sin secretos', async () => {
  for (const status of [401, 403]) {
    const d = dbFalso();
    const dep = deps(fetchFalso(loginOk(), res(status, `API Key inválida: ${API_KEY}`)));
    const r = await probarConexion(d.client, EMPRESA, 'TesteCF', dep);

    assert.equal(r.ok, false);
    assert.match(r.error, /API key/);
    assert.match(r.error, /TesteCF/);
    assert.ok(sinSecretos(r.error), r.error);
    assert.equal(d.from.length, 0, 'no debía marcar la conexión');
    // La cuenta sí inició sesión: la sesión queda guardada. Un rechazo no gasta cupo.
    assert.deepEqual(d.rpc.map((x) => x.fn), ['ecf_leer_credenciales', 'ecf_guardar_sesion']);
    assert.deepEqual(dep.registro, [], 'un fallo de MSeller no va al registro');
  }
});

test('probar_conexion: la key sirve si MSeller atiende la consulta, aunque no conozca el e-NCF u objete el parámetro', async () => {
  for (const respuesta of [noEncontrado(), res(200, { status: 'No encontrado' }), res(400, 'ecf inválido')]) {
    const d = dbFalso();
    const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), respuesta)));
    assert.deepEqual(r, { ok: true, marcada: true });
  }
});

test('probar_conexion: la consulta atendida suma 1 al uso del plan; sin respuesta, sin cupo o rechazada no suma', async () => {
  const atendida = dbFalso();
  await probarConexion(atendida.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), noEncontrado())));
  const uso = atendida.rpc.find((x) => x.fn === 'ecf_sumar_uso');
  assert.deepEqual(uso.args, { p_company: EMPRESA, p_requests: 1, p_comprobantes: 0 });

  for (const respuesta of [res(403, 'no'), res(429, 'sin cupo'), new Error('sin red')]) {
    const d = dbFalso();
    await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), respuesta)));
    assert.ok(!d.rpc.some((x) => x.fn === 'ecf_sumar_uso'), 'no debía sumar uso');
  }
});

test('probar_conexion: sin cupo, sin red o con MSeller caído en la consulta no marca la conexión', async () => {
  for (const respuesta of [res(429, 'sin cupo'), res(503, 'caído'), new Error('sin red')]) {
    const d = dbFalso();
    const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), respuesta)));
    assert.equal(r.ok, false);
    assert.match(r.error, /MSeller/);
    assert.equal(d.from.length, 0);
  }
});

test('probar_conexion: si sumar el uso falla, la prueba igual sale bien', async () => {
  const d = dbFalso({ rpcs: { ecf_sumar_uso: { data: null, error: { message: 'boom' } } } });
  const r = await probarConexion(d.client, EMPRESA, 'TesteCF', deps(fetchFalso(loginOk(), noEncontrado())));
  assert.deepEqual(r, { ok: true, marcada: true });
});

// ---------------------------------------------------------------------------
// ocultar y motivoDe
// ---------------------------------------------------------------------------

test('ocultar cambia cada aparición de cada secreto y deja en paz los muy cortos, los nulos y los vacíos', () => {
  assert.equal(ocultar(`a ${PASSWORD} b ${PASSWORD} c ${API_KEY}`, [PASSWORD, API_KEY]), 'a *** b *** c ***');
  assert.equal(ocultar('abc 123', ['abc', '123', '', null, undefined]), 'abc 123');
  assert.equal(ocultar('x abcd y', ['abcd']), 'x *** y');
  assert.equal(ocultar('sin nada', [PASSWORD]), 'sin nada');
});

test('motivoDe aclara solo los 400/422 de MSeller (cuerpo crudo); los demás ya vienen en español', () => {
  assert.equal(motivoDe(new MsellerError('datos', 'Bad request', 400)), 'MSeller no aceptó el inicio de sesión: Bad request');
  assert.equal(motivoDe(new MsellerError('auth', 'MSeller rechazó la autenticación (401)', 401)), 'MSeller rechazó la autenticación (401)');
  assert.equal(motivoDe(new Error('boom')), 'boom');
  assert.equal(motivoDe('texto'), 'texto');
});

// ---------------------------------------------------------------------------
// guardar_credenciales
// ---------------------------------------------------------------------------

const PEDIDO_GUARDAR = {
  accion: 'guardar_credenciales',
  companyId: EMPRESA,
  ambiente: 'TesteCF',
  email: EMAIL,
  password: PASSWORD,
  apiKey: API_KEY,
};

test('guardar_credenciales manda a ecf_guardar_credenciales la empresa, el ambiente y las tres credenciales y responde solo ok', async () => {
  const d = dbFalso();
  const r = await administrar(d.client, PEDIDO_GUARDAR, deps(fetchFalso()));
  assert.deepEqual(r, { status: 200, cuerpo: { ok: true } });
  assert.deepEqual(d.rpc, [
    {
      fn: 'ecf_guardar_credenciales',
      args: { p_company: EMPRESA, p_ambiente: 'TesteCF', p_email: EMAIL, p_password: PASSWORD, p_api_key: API_KEY },
    },
  ]);
  // Antes comprobó que la empresa existe.
  assert.equal(d.from[0].tabla, 'companies');
  assert.deepEqual(d.from[0].filtros, [['id', EMPRESA]]);
  assert.ok(sinSecretos(JSON.stringify(r)));
});

test('guardar_credenciales: falta el correo, la contraseña o la API key -> 400 sin tocar la base', async () => {
  const casos = [
    [{ email: undefined }, 'Falta el correo de la cuenta de MSeller.'],
    [{ email: '   ' }, 'Falta el correo de la cuenta de MSeller.'],
    [{ email: 42 }, 'Falta el correo de la cuenta de MSeller.'],
    [{ password: '' }, 'Falta la contraseña de la cuenta de MSeller.'],
    [{ password: null }, 'Falta la contraseña de la cuenta de MSeller.'],
    [{ apiKey: '' }, 'Falta la API key de MSeller.'],
    [{ apiKey: undefined }, 'Falta la API key de MSeller.'],
  ];
  for (const [cambio, mensaje] of casos) {
    const d = dbFalso();
    const r = await administrar(d.client, { ...PEDIDO_GUARDAR, ...cambio }, deps(fetchFalso()));
    assert.deepEqual(r, { status: 400, cuerpo: { ok: false, error: mensaje } }, mensaje);
    assert.equal(d.rpc.length + d.from.length, 0);
  }
});

test('guardar_credenciales: una empresa que no existe -> 404 y no guarda nada', async () => {
  const d = dbFalso({ empresa: null });
  const r = await administrar(d.client, PEDIDO_GUARDAR, deps(fetchFalso()));
  assert.deepEqual(r, { status: 404, cuerpo: { ok: false, error: 'La empresa no existe.' } });
  assert.equal(d.rpc.length, 0);
});

test('guardar_credenciales: si la base falla responde 500 genérico y el registro no lleva la contraseña ni la API key', async () => {
  const eco = `no se pudo: ${PASSWORD} / ${API_KEY}`;
  const fallos = [
    dbFalso({ rpcs: { ecf_guardar_credenciales: { data: null, error: { message: eco } } } }),
    dbFalso({ errorEmpresa: { message: eco } }),
  ];
  for (const d of fallos) {
    const dep = deps(fetchFalso());
    const r = await administrar(d.client, PEDIDO_GUARDAR, dep);
    assert.deepEqual(r, { status: 500, cuerpo: { ok: false, error: ERROR_INTERNO } });
    assert.equal(dep.registro.length, 1);
    assert.ok(dep.registro[0].startsWith('ecf-admin: '), dep.registro[0]);
    assert.ok(dep.registro[0].includes('***'));
    assert.ok(sinSecretos(dep.registro[0]), `el registro dejó salir un secreto: ${dep.registro[0]}`);
    assert.ok(sinSecretos(JSON.stringify(r)));
  }
});

test('guardarCredenciales (directo) valida antes de consultar la base', async () => {
  const d = dbFalso();
  const r = await guardarCredenciales(d.client, EMPRESA, 'eCF', { email: EMAIL, password: PASSWORD });
  assert.equal(r.status, 400);
  assert.equal(d.from.length, 0);
});

// ---------------------------------------------------------------------------
// administrar: validación del pedido y despacho
// ---------------------------------------------------------------------------

test('administrar rechaza lo que no es un pedido válido sin tocar la base ni a MSeller', async () => {
  const casos = [
    [null, 'Solicitud inválida.'],
    [undefined, 'Solicitud inválida.'],
    ['texto', 'Solicitud inválida.'],
    [[1, 2], 'Solicitud inválida.'],
    [{ accion: 'probar_conexion', ambiente: 'TesteCF' }, 'La empresa no es válida.'],
    [{ accion: 'probar_conexion', companyId: 'no-es-uuid', ambiente: 'TesteCF' }, 'La empresa no es válida.'],
    [{ accion: 'probar_conexion', companyId: EMPRESA }, 'El ambiente debe ser TesteCF, CerteCF o eCF.'],
    [{ accion: 'probar_conexion', companyId: EMPRESA, ambiente: 'produccion' }, 'El ambiente debe ser TesteCF, CerteCF o eCF.'],
    [{ accion: 'borrar_todo', companyId: EMPRESA, ambiente: 'TesteCF' }, 'Acción desconocida. Usa guardar_credenciales o probar_conexion.'],
    [{ companyId: EMPRESA, ambiente: 'TesteCF' }, 'Acción desconocida. Usa guardar_credenciales o probar_conexion.'],
  ];
  for (const [body, mensaje] of casos) {
    const d = dbFalso();
    const f = fetchFalso();
    const r = await administrar(d.client, body, deps(f));
    assert.deepEqual(r, { status: 400, cuerpo: { ok: false, error: mensaje } }, mensaje);
    assert.equal(d.rpc.length + d.from.length + f.llamadas.length, 0);
  }
});

test('administrar despacha probar_conexion: un login fallido sigue siendo HTTP 200 con ok:false', async () => {
  const bueno = await administrar(
    dbFalso().client,
    { accion: 'probar_conexion', companyId: EMPRESA, ambiente: 'TesteCF' },
    deps(fetchFalso(loginOk(), noEncontrado())),
  );
  assert.deepEqual(bueno, { status: 200, cuerpo: { ok: true, marcada: true } });

  const malo = await administrar(
    dbFalso().client,
    { accion: 'probar_conexion', companyId: EMPRESA, ambiente: 'TesteCF' },
    deps(fetchFalso(res(401, `no: ${PASSWORD}`))),
  );
  assert.equal(malo.status, 200);
  assert.equal(malo.cuerpo.ok, false);
  assert.ok(sinSecretos(malo.cuerpo.error));
});

test('administrar: una excepción inesperada sale como 500 genérico y el registro no lleva lo que mandó el panel', async () => {
  const d = dbFalso();
  d.client.rpc = async () => {
    throw new Error(`se cayó con ${PASSWORD} y ${API_KEY}`);
  };
  const dep = deps(fetchFalso());
  const r = await administrar(d.client, PEDIDO_GUARDAR, dep);
  assert.deepEqual(r, { status: 500, cuerpo: { ok: false, error: ERROR_INTERNO } });
  assert.ok(sinSecretos(dep.registro.join('\n')), dep.registro.join('\n'));
});
