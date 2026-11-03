// Pruebas del cliente de MSeller (módulo puro con `fetch` inyectable). Nunca se
// llama a la API real: cada prueba arma un `fetch` falso que guarda las
// peticiones y responde lo que se le indica. `npm test` corre `node --test`;
// Node quita los tipos de mseller.ts al importarlo, por eso ese archivo solo
// puede usar sintaxis borrable (nada de enum, namespace ni parameter properties).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MSELLER_BASE,
  MsellerError,
  subDeIdToken,
  sesionVigente,
  enviar,
  consultar,
  consultarLote,
  mapearEstado,
  extraerMensajes,
  proximoIntento,
} from '../../supabase/functions/_shared/ecf/mseller.ts';

const AHORA = new Date('2026-10-30T12:00:00.000Z');
const minutos = (n) => new Date(AHORA.getTime() + n * 60_000);

// JWT de mentira: solo importa el payload (la firma no se valida).
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.firma`;

const SUB = '3f2a9c1e-8b7d-4e5f-a6b1-0c9d8e7f6a5b';
const ID_TOKEN = jwt({ sub: SUB, 'cognito:username': SUB, email: 'ana@ejemplo.com' });

// Respuesta JSON de MSeller.
const res = (status, cuerpo) =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// `fetch` falso: atiende en orden lo que se le dio (una Response, un Error que
// se lanza, o una función que recibe la petición) y guarda cada llamada.
function fetchFalso(...respuestas) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    llamadas.push({
      url: String(url),
      metodo: init.method,
      headers: new Headers(init.headers),
      cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    });
    const r = respuestas.shift();
    if (r === undefined) throw new Error('fetch falso sin respuesta preparada');
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(llamadas.at(-1)) : r;
  };
  f.llamadas = llamadas;
  return f;
}

// Credenciales completas de una empresa; cada prueba pisa lo que necesita.
const creds = (over = {}) => ({
  email: 'ana@ejemplo.com',
  password: 'clave-secreta-123',
  apiKey: 'api-key-secreta-456',
  refreshToken: null,
  sub: null,
  idToken: null,
  idTokenVence: null,
  ...over,
});

const sesion = (over = {}) => ({
  idToken: 'id-token-secreto-789',
  idTokenVence: minutos(55).toISOString(),
  refreshToken: 'ref',
  sub: SUB,
  ...over,
});

const API_KEY = 'api-key-secreta-456';

// La promesa debe rechazarse con un MsellerError del tipo y status indicados.
const falla = (promesa, tipo, status) =>
  assert.rejects(promesa, (e) => {
    assert.ok(e instanceof MsellerError, `esperaba MsellerError, llegó ${e}`);
    assert.equal(e.tipo, tipo);
    if (status !== undefined) assert.equal(e.status, status);
    return true;
  });

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

test('subDeIdToken lee el sub del payload', () => {
  assert.equal(subDeIdToken(ID_TOKEN), SUB);
});

test('subDeIdToken decodifica base64url (guiones, guiones bajos y sin relleno)', () => {
  // '?' y '>' dan '/' y '+' en base64 normal: en base64url salen '_' y '-'.
  const payload = { sub: SUB, n: 'Muñoz ?>>~~?>>' };
  const parte = b64url(payload);
  assert.match(parte, /[-_]/, 'la prueba debe ejercitar el alfabeto url-safe');
  assert.doesNotMatch(parte, /=/, 'base64url no lleva relleno');
  assert.equal(subDeIdToken(`x.${parte}.y`), SUB);
});

test('subDeIdToken lanza MsellerError si el token no se puede leer, sin mostrarlo', () => {
  for (const malo of ['', 'solo-una-parte', 'a.%%%.c', `a.${b64url({ otro: 1 })}.c`]) {
    assert.throws(
      () => subDeIdToken(malo),
      (e) => e instanceof MsellerError && !e.message.includes('solo-una-parte') && e.tipo === 'servidor',
    );
  }
});

test('sesionVigente usa el token guardado si vence en más de 1 min', async () => {
  const f = fetchFalso();
  const c = creds({ idToken: ID_TOKEN, idTokenVence: minutos(2).toISOString(), refreshToken: 'ref', sub: SUB });
  const r = await sesionVigente(c, 'TesteCF', f, AHORA);
  assert.equal(f.llamadas.length, 0);
  assert.equal(r.nueva, false);
  assert.deepEqual(r.sesion, {
    idToken: ID_TOKEN,
    idTokenVence: minutos(2).toISOString(),
    refreshToken: 'ref',
    sub: SUB,
  });
});

test('sesionVigente saca el sub del idToken guardado si no hay sub guardado', async () => {
  const f = fetchFalso();
  const c = creds({ idToken: ID_TOKEN, idTokenVence: minutos(30).toISOString(), sub: null });
  const r = await sesionVigente(c, 'TesteCF', f, AHORA);
  assert.equal(f.llamadas.length, 0);
  assert.equal(r.sesion.sub, SUB);
  assert.equal(r.sesion.refreshToken, null);
});

test('sesionVigente renueva si al token le queda 1 min o menos', async () => {
  const f = fetchFalso(res(200, { idToken: ID_TOKEN, accessToken: 'a' }));
  const c = creds({ idToken: 'viejo', idTokenVence: minutos(1).toISOString(), refreshToken: 'ref', sub: 'sub-1' });
  const r = await sesionVigente(c, 'TesteCF', f, AHORA);
  assert.equal(f.llamadas.length, 1);
  assert.equal(r.nueva, true);
});

test('sesionVigente renueva con refreshToken y username = sub', async () => {
  const f = fetchFalso(res(200, { accessToken: 'acc', idToken: ID_TOKEN }));
  const c = creds({ refreshToken: 'ref', sub: 'sub-1' });
  const r = await sesionVigente(c, 'TesteCF', f, AHORA);

  assert.equal(f.llamadas.length, 1);
  const [llamada] = f.llamadas;
  assert.equal(llamada.url, `${MSELLER_BASE}/TesteCF/customer/authentication`);
  assert.equal(llamada.metodo, 'POST');
  assert.equal(llamada.headers.get('content-type'), 'application/json');
  assert.deepEqual(llamada.cuerpo, { refreshToken: 'ref', username: 'sub-1' });

  assert.equal(r.nueva, true);
  assert.equal(r.sesion.idToken, ID_TOKEN);
  // La respuesta de renovación no trae refreshToken: se conserva el anterior.
  assert.equal(r.sesion.refreshToken, 'ref');
  assert.equal(r.sesion.sub, 'sub-1');
  assert.equal(r.sesion.idTokenVence, minutos(55).toISOString());
});

test('sesionVigente vuelve a iniciar sesión si la renovación da 401', async () => {
  const f = fetchFalso(
    res(401, { message: 'Refresh Token has expired' }),
    res(200, { idToken: ID_TOKEN, refreshToken: 'ref-nuevo', accessToken: 'a' }),
  );
  const c = creds({ refreshToken: 'ref-viejo', sub: 'sub-1' });
  const r = await sesionVigente(c, 'CerteCF', f, AHORA);

  assert.equal(f.llamadas.length, 2);
  assert.deepEqual(f.llamadas[0].cuerpo, { refreshToken: 'ref-viejo', username: 'sub-1' });
  assert.deepEqual(f.llamadas[1].cuerpo, { email: 'ana@ejemplo.com', password: 'clave-secreta-123' });
  assert.equal(f.llamadas[1].url, `${MSELLER_BASE}/CerteCF/customer/authentication`);

  assert.equal(r.nueva, true);
  assert.equal(r.sesion.idToken, ID_TOKEN);
  assert.equal(r.sesion.refreshToken, 'ref-nuevo');
  // El sub sale del idToken recién emitido.
  assert.equal(r.sesion.sub, SUB);
  assert.equal(r.sesion.idTokenVence, minutos(55).toISOString());
});

test('sesionVigente sin sesión ni refreshToken inicia sesión con correo y contraseña', async () => {
  const f = fetchFalso(res(200, { idToken: ID_TOKEN, refreshToken: 'ref-1', accessToken: 'a' }));
  const r = await sesionVigente(creds(), 'eCF', f, AHORA);
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].url, `${MSELLER_BASE}/eCF/customer/authentication`);
  assert.deepEqual(f.llamadas[0].cuerpo, { email: 'ana@ejemplo.com', password: 'clave-secreta-123' });
  assert.equal(r.nueva, true);
  assert.equal(r.sesion.refreshToken, 'ref-1');
  assert.equal(r.sesion.sub, SUB);
});

test('forzar un login nuevo: idToken, idTokenVence y refreshToken en null inician sesión con contraseña', async () => {
  // Es la decisión R3: no hay función aparte; se pone en null lo guardado.
  const f = fetchFalso(res(200, { idToken: ID_TOKEN, refreshToken: 'ref-2', accessToken: 'a' }));
  const c = creds({ idToken: null, idTokenVence: null, refreshToken: null, sub: SUB });
  const r = await sesionVigente(c, 'TesteCF', f, AHORA);
  assert.equal(f.llamadas.length, 1);
  assert.deepEqual(f.llamadas[0].cuerpo, { email: 'ana@ejemplo.com', password: 'clave-secreta-123' });
  assert.equal(r.nueva, true);
  assert.equal(r.sesion.refreshToken, 'ref-2');
});

test('sesionVigente: si el login da 401 el error es de tipo auth y no filtra la contraseña', async () => {
  const f = fetchFalso(res(401, { message: 'Incorrect username or password. clave-secreta-123' }));
  await assert.rejects(sesionVigente(creds(), 'TesteCF', f, AHORA), (e) => {
    assert.ok(e instanceof MsellerError);
    assert.equal(e.tipo, 'auth');
    assert.equal(e.status, 401);
    assert.doesNotMatch(e.message, /clave-secreta-123/);
    return true;
  });
});

test('sesionVigente: una renovación con error de servidor no cae al login', async () => {
  const f = fetchFalso(res(503, 'caído'));
  const c = creds({ refreshToken: 'ref', sub: 'sub-1' });
  await falla(sesionVigente(c, 'TesteCF', f, AHORA), 'servidor', 503);
  assert.equal(f.llamadas.length, 1);
});

test('sesionVigente: una respuesta de login sin idToken es un fallo del servidor', async () => {
  const f = fetchFalso(res(200, { accessToken: 'a' }));
  await falla(sesionVigente(creds(), 'TesteCF', f, AHORA), 'servidor');
});

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

const RESPUESTA_ENVIO = {
  rnc: '102320705',
  ecf: 'E310000009175',
  internalTrackId: '58f1bdd7-f4be-4a2e-a1e6-570c95b8d477',
  securityCode: 'fWCZCV',
  qr_url: 'https://ecf.dgii.gov.do/testecf/consultatimbre?encf=E310000009175&codigoseguridad=fWCZCV',
  signedDate: '14-05-2025 02:57:33',
};

test('enviar manda Bearer y X-API-KEY a la URL del ambiente', async () => {
  const f = fetchFalso(res(200, RESPUESTA_ENVIO));
  const json = { ECF: { Encabezado: {} } };
  const r = await enviar('TesteCF', sesion(), API_KEY, json, f);

  assert.equal(f.llamadas.length, 1);
  const [llamada] = f.llamadas;
  assert.equal(llamada.url, 'https://ecf.api.mseller.app/TesteCF/documentos-ecf');
  assert.equal(llamada.metodo, 'POST');
  assert.equal(llamada.headers.get('authorization'), 'Bearer id-token-secreto-789');
  assert.equal(llamada.headers.get('x-api-key'), API_KEY);
  assert.equal(llamada.headers.get('content-type'), 'application/json');
  assert.deepEqual(llamada.cuerpo, json);
  assert.ok(llamada.signal instanceof AbortSignal, 'cada llamada lleva su corte por tiempo');

  assert.deepEqual(r, {
    ecf: 'E310000009175',
    internalTrackId: '58f1bdd7-f4be-4a2e-a1e6-570c95b8d477',
    securityCode: 'fWCZCV',
    qrUrl: RESPUESTA_ENVIO.qr_url,
    signedDate: '14-05-2025 02:57:33',
  });
});

test('enviar usa el ambiente que se le pasa', async () => {
  const f = fetchFalso(res(200, RESPUESTA_ENVIO));
  await enviar('eCF', sesion(), API_KEY, {}, f);
  assert.equal(f.llamadas[0].url, 'https://ecf.api.mseller.app/eCF/documentos-ecf');
});

// ---------------------------------------------------------------------------
// Clasificación de errores
// ---------------------------------------------------------------------------

test('429 es cupo y 400 es datos', async () => {
  await falla(enviar('TesteCF', sesion(), API_KEY, {}, fetchFalso(res(429, { message: 'Limit Exceeded' }))), 'cupo', 429);
  await falla(enviar('TesteCF', sesion(), API_KEY, {}, fetchFalso(res(400, { message: 'mal' }))), 'datos', 400);
});

test('cada código HTTP cae en su tipo', async () => {
  const casos = [
    [401, 'auth'],
    [403, 'auth'],
    [422, 'datos'],
    [409, 'datos'],
    [404, 'no_encontrado'],
    [500, 'servidor'],
    [502, 'servidor'],
    [503, 'servidor'],
  ];
  for (const [status, tipo] of casos) {
    await falla(enviar('TesteCF', sesion(), API_KEY, {}, fetchFalso(res(status, 'x'))), tipo, status);
  }
});

test('un 400 lleva el texto del cuerpo, recortado a 500 caracteres', async () => {
  const cuerpo = JSON.stringify({ message: 'El campo X es inválido' });
  await assert.rejects(enviar('TesteCF', sesion(), API_KEY, {}, fetchFalso(res(400, cuerpo))), (e) => {
    assert.equal(e.tipo, 'datos');
    assert.equal(e.message, cuerpo);
    return true;
  });

  const largo = 'a'.repeat(900);
  await assert.rejects(enviar('TesteCF', sesion(), API_KEY, {}, fetchFalso(res(422, largo))), (e) => {
    assert.equal(e.tipo, 'datos');
    assert.equal(e.message, 'a'.repeat(500));
    return true;
  });
});

test('un 400 sin cuerpo igual trae un mensaje', async () => {
  await assert.rejects(enviar('TesteCF', sesion(), API_KEY, {}, fetchFalso(res(400, ''))), (e) => {
    assert.equal(e.tipo, 'datos');
    assert.ok(e.message.length > 0);
    return true;
  });
});

test('una excepción de red es tipo red', async () => {
  const f = fetchFalso(new TypeError('fetch failed'));
  await falla(enviar('TesteCF', sesion(), API_KEY, {}, f), 'red');
});

test('un corte por tiempo (TimeoutError) es tipo red', async () => {
  const f = fetchFalso(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  await falla(consultar('TesteCF', sesion(), API_KEY, 'E310000000001', f), 'red');
});

test('los secretos no salen en los mensajes de error', async () => {
  const s = sesion();
  const contenido = (e) => `${e.message} ${e.stack ?? ''} ${JSON.stringify(e)}`;

  // Cada llamada solo conoce sus propios secretos: las de la API, el token y la
  // API key; el login, además, la contraseña.
  const casos = [
    // El servidor devuelve en el cuerpo del 400 lo que se le mandó.
    [() => enviar('TesteCF', s, API_KEY, {}, fetchFalso(res(400, `Bearer ${s.idToken} / ${API_KEY}`))), [s.idToken, API_KEY]],
    // Una excepción de red que arrastra el token en su texto.
    [() => enviar('TesteCF', s, API_KEY, {}, fetchFalso(new TypeError(`fetch failed ${s.idToken} ${API_KEY}`))), [s.idToken, API_KEY]],
    [() => consultarLote('TesteCF', s, API_KEY, ['E1'], fetchFalso(res(500, `error ${API_KEY}`))), [API_KEY]],
    [() => consultar('TesteCF', s, API_KEY, 'E1', fetchFalso(res(401, `token ${s.idToken}`))), [s.idToken]],
    [() => sesionVigente(creds(), 'TesteCF', fetchFalso(res(400, 'clave-secreta-123 incorrecta')), AHORA), ['clave-secreta-123']],
    [() => sesionVigente(creds(), 'TesteCF', fetchFalso(new TypeError('fetch failed clave-secreta-123')), AHORA), ['clave-secreta-123']],
    [() => sesionVigente(creds({ refreshToken: 'ref-secreto-999', sub: 'sub-1' }), 'TesteCF', fetchFalso(res(503, 'ref-secreto-999')), AHORA), ['ref-secreto-999']],
  ];
  for (const [caso, secretos] of casos) {
    await assert.rejects(caso(), (e) => {
      assert.ok(e instanceof MsellerError);
      for (const secreto of secretos) assert.ok(!contenido(e).includes(secreto), `se coló un secreto: ${secreto}`);
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

test('consultar arma la URL con ?ecf= y mapea la respuesta', async () => {
  const f = fetchFalso(
    res(200, {
      status: 'Aceptado',
      dgiiResponse: [
        '{"trackId":"0cc4","error":null,"mensaje":null}',
        '{"trackId":"0cc4","codigo":"1","estado":"Aceptado","mensajes":[{"valor":"","codigo":0}]}',
      ],
      securityCode: 'hhABiM',
      qr_url: 'https://ecf.dgii.gov.do/testecf/consultatimbre?encf=E310000009179',
      internalTrackId: 'a118ea44-ac12-466a-b071-c4b650bb5a4f',
      ncf: 'E310000009179',
    }),
  );
  const r = await consultar('TesteCF', sesion(), API_KEY, 'E310000009179', f);

  const [llamada] = f.llamadas;
  assert.equal(llamada.url, 'https://ecf.api.mseller.app/TesteCF/documentos-ecf?ecf=E310000009179');
  assert.equal(llamada.metodo, 'GET');
  assert.equal(llamada.headers.get('authorization'), 'Bearer id-token-secreto-789');
  assert.equal(llamada.headers.get('x-api-key'), API_KEY);
  assert.equal(llamada.cuerpo, undefined);
  assert.ok(llamada.signal instanceof AbortSignal);

  assert.deepEqual(r, {
    ecf: 'E310000009179',
    estado: 'aceptado',
    mensajes: [],
    securityCode: 'hhABiM',
    qrUrl: 'https://ecf.dgii.gov.do/testecf/consultatimbre?encf=E310000009179',
    internalTrackId: 'a118ea44-ac12-466a-b071-c4b650bb5a4f',
  });
});

test('consultar trae los mensajes de un rechazo', async () => {
  const f = fetchFalso(
    res(200, {
      status: 'Rechazado',
      dgiiResponse: [
        '{"estado":"Rechazado","mensajes":[{"valor":"Falta el campo Y","codigo":1920}]}',
      ],
    }),
  );
  const r = await consultar('TesteCF', sesion(), API_KEY, 'E310000000007', f);
  assert.equal(r.estado, 'rechazado');
  assert.deepEqual(r.mensajes, [{ codigo: 1920, valor: 'Falta el campo Y' }]);
  assert.equal(r.securityCode, undefined);
  assert.equal(r.qrUrl, undefined);
});

test('consultar devuelve null si no existe', async () => {
  assert.equal(await consultar('TesteCF', sesion(), API_KEY, 'E310000000001', fetchFalso(res(404, { message: 'no' }))), null);
  assert.equal(
    await consultar('TesteCF', sesion(), API_KEY, 'E310000000001', fetchFalso(res(200, { status: 'No encontrado' }))),
    null,
  );
});

test('consultar propaga los demás errores', async () => {
  await falla(consultar('TesteCF', sesion(), API_KEY, 'E1', fetchFalso(res(401, 'x'))), 'auth', 401);
  await falla(consultar('TesteCF', sesion(), API_KEY, 'E1', fetchFalso(res(500, 'x'))), 'servidor', 500);
});

// ---------------------------------------------------------------------------
// Consulta en lote
// ---------------------------------------------------------------------------

const ecfsDe = (n) => Array.from({ length: n }, (_, i) => `E31${String(i).padStart(10, '0')}`);

test('consultarLote rechaza más de 100', async () => {
  const f = fetchFalso();
  await assert.rejects(consultarLote('TesteCF', sesion(), API_KEY, ecfsDe(101), f), RangeError);
  assert.equal(f.llamadas.length, 0);
});

test('consultarLote acepta 100 y manda { ecfs }', async () => {
  const ecfs = ecfsDe(100);
  const f = fetchFalso(res(200, { total: 100, results: ecfs.map((ecf) => ({ ecf, status: 'Aceptado', found: true, data: {} })) }));
  const r = await consultarLote('TesteCF', sesion(), API_KEY, ecfs, f);
  const [llamada] = f.llamadas;
  assert.equal(llamada.url, 'https://ecf.api.mseller.app/TesteCF/documentos-ecf/status/batch');
  assert.equal(llamada.metodo, 'POST');
  assert.equal(llamada.headers.get('authorization'), 'Bearer id-token-secreto-789');
  assert.equal(llamada.headers.get('x-api-key'), API_KEY);
  assert.equal(llamada.headers.get('content-type'), 'application/json');
  assert.deepEqual(llamada.cuerpo, { ecfs });
  assert.equal(r.length, 100);
});

test('consultarLote con lista vacía no llama a MSeller', async () => {
  const f = fetchFalso();
  assert.deepEqual(await consultarLote('TesteCF', sesion(), API_KEY, [], f), []);
  assert.equal(f.llamadas.length, 0);
});

test('consultarLote mapea found:false a no_encontrado', async () => {
  const f = fetchFalso(
    res(200, {
      total: 2,
      results: [
        { ecf: 'E310000000001', status: 'Aceptado', found: true, data: { securityCode: 'abc123', qr_url: 'https://qr/1', internalTrackId: 'it-1' } },
        { ecf: 'E310000000002', found: false },
      ],
    }),
  );
  const r = await consultarLote('TesteCF', sesion(), API_KEY, ['E310000000001', 'E310000000002'], f);
  assert.deepEqual(r, [
    { ecf: 'E310000000001', estado: 'aceptado', mensajes: [], securityCode: 'abc123', qrUrl: 'https://qr/1', internalTrackId: 'it-1' },
    { ecf: 'E310000000002', estado: 'no_encontrado', mensajes: [] },
  ]);
});

test('consultarLote entiende el ejemplo de la documentación (rechazo con código 1920)', async () => {
  const f = fetchFalso(
    res(200, {
      total: 2,
      results: [
        {
          ecf: 'E310000510916',
          status: 'Rechazado',
          found: true,
          data: {
            dgiiResponse: [
              '{"trackId":"32c4f7e0-dbbe-40cc-a1d4-e4cc0ff82c13","codigo":"2","estado":"Rechazado","rnc":"102320705","encf":"E310000510916","secuenciaUtilizada":true,"fechaRecepcion":"11/3/2025 8:19:30 PM","mensajes":[{"valor":"El campo MontoGravadoTotal del área Totales de la sección Encabezado","codigo":1920}]}',
            ],
            status: 'Rechazado',
          },
        },
        {
          ecf: 'E320004380895',
          status: 'Aceptado',
          found: true,
          data: {
            dgiiResponse: ['{"codigo":1,"estado":"Aceptado","mensajes":null,"encf":"E320004380895","secuenciaUtilizada":true}'],
            securityCode: 'A7HXQC',
            qr_url: 'https://fc.dgii.gov.do/testecf/consultatimbrefc?encf=E320004380895',
            internalTrackId: 'aada68a0-42c6-4a0a-804a-db9c042e1dc6',
          },
        },
      ],
    }),
  );
  const r = await consultarLote('TesteCF', sesion(), API_KEY, ['E310000510916', 'E320004380895'], f);
  assert.equal(r[0].ecf, 'E310000510916');
  assert.equal(r[0].estado, 'rechazado');
  assert.deepEqual(r[0].mensajes, [
    { codigo: 1920, valor: 'El campo MontoGravadoTotal del área Totales de la sección Encabezado' },
  ]);
  assert.equal(r[1].estado, 'aceptado');
  assert.deepEqual(r[1].mensajes, []);
  assert.equal(r[1].securityCode, 'A7HXQC');
});

test('consultarLote: una respuesta sin results es un fallo del servidor', async () => {
  await falla(consultarLote('TesteCF', sesion(), API_KEY, ['E1'], fetchFalso(res(200, { total: 1 }))), 'servidor');
});

// ---------------------------------------------------------------------------
// Estados, mensajes y reintentos
// ---------------------------------------------------------------------------

test('mapearEstado', () => {
  assert.equal(mapearEstado('En Cola'), 'recibido');
  assert.equal(mapearEstado('Enviado a la DGII'), 'recibido');
  assert.equal(mapearEstado('En Proceso'), 'recibido');
  assert.equal(mapearEstado('Aceptado'), 'aceptado');
  assert.equal(mapearEstado('Aceptado Condicional'), 'aceptado_condicional');
  assert.equal(mapearEstado('Rechazado'), 'rechazado');
  assert.equal(mapearEstado('No encontrado'), 'no_encontrado');
  assert.equal(mapearEstado('Error'), 'error_datos');
  // Cualquier valor que no conozcamos se trata como error.
  assert.equal(mapearEstado('Algo nuevo'), 'error_datos');
  assert.equal(mapearEstado(''), 'error_datos');
});

// String copiado tal cual de la documentación de MSeller (consulta en batch).
const DGII_RECHAZO =
  '{"trackId":"32c4f7e0-dbbe-40cc-a1d4-e4cc0ff82c13","codigo":"2","estado":"Rechazado","rnc":"102320705","encf":"E310000510916","secuenciaUtilizada":true,"fechaRecepcion":"11/3/2025 8:19:30 PM","mensajes":[{"valor":"El campo MontoGravadoTotal del área Totales de la sección Encabezado","codigo":1920}]}';

test('extraerMensajes saca el código 1920 del ejemplo de MSeller', () => {
  assert.deepEqual(extraerMensajes([DGII_RECHAZO]), [
    { codigo: 1920, valor: 'El campo MontoGravadoTotal del área Totales de la sección Encabezado' },
  ]);
});

test('extraerMensajes toma los del último string que los tenga', () => {
  const primero = '{"estado":"Rechazado","mensajes":[{"valor":"Viejo","codigo":1}]}';
  const sinMensajes = '{"trackId":"x","error":null,"mensaje":null}';
  assert.deepEqual(extraerMensajes([primero, DGII_RECHAZO, sinMensajes]), [
    { codigo: 1920, valor: 'El campo MontoGravadoTotal del área Totales de la sección Encabezado' },
  ]);
});

test('extraerMensajes descarta valores vacíos y convierte el código a número', () => {
  const s = '{"mensajes":[{"valor":"","codigo":0},{"valor":"Algo falló","codigo":"11105"},{"valor":"   ","codigo":3}]}';
  assert.deepEqual(extraerMensajes([s]), [{ codigo: 11105, valor: 'Algo falló' }]);
});

test('extraerMensajes ignora lo que no sea JSON con mensajes', () => {
  assert.deepEqual(extraerMensajes(undefined), []);
  assert.deepEqual(extraerMensajes([]), []);
  assert.deepEqual(extraerMensajes(['no es json', '{"mensajes":null}', '[1,2]', 'null', '"texto"']), []);
});

test('proximoIntento', () => {
  assert.equal(proximoIntento(1, AHORA).getTime(), minutos(1).getTime());
  assert.equal(proximoIntento(2, AHORA).getTime(), minutos(2).getTime());
  assert.equal(proximoIntento(3, AHORA).getTime(), minutos(5).getTime());
  assert.equal(proximoIntento(4, AHORA).getTime(), minutos(10).getTime());
  assert.equal(proximoIntento(5, AHORA).getTime(), minutos(30).getTime());
  assert.equal(proximoIntento(6, AHORA).getTime(), minutos(60).getTime());
  assert.equal(proximoIntento(9, AHORA).getTime(), minutos(60).getTime());
  // No se muta la fecha recibida.
  assert.equal(AHORA.toISOString(), '2026-10-30T12:00:00.000Z');
});
