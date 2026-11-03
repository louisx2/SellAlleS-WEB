// Pruebas de la emisión de un e-CF (orquestador puro con dependencias
// inyectadas). Nunca se llama a MSeller ni a la base de datos: cada prueba arma
// dependencias falsas en memoria (con un `fetch` falso que guarda las
// peticiones) y mira qué se registra, qué se cuenta y qué se manda. `npm test`
// corre `node --test`; Node quita los tipos de emitir.ts, por eso ese archivo
// solo puede usar sintaxis borrable.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emitirDocumento,
  completarDocumento,
  ErrorDatosEcf,
} from '../../supabase/functions/_shared/ecf/emitir.ts';
import {
  datosEcf,
  vencimientoDeSecuencia,
  sumarDias,
  diasEntre,
} from '../../supabase/functions/_shared/ecf/datos.ts';
import { armarEcf } from '../../supabase/functions/_shared/ecf/armar.ts';

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

const DOC_ID = '00000000-0000-0000-0000-00000000ec01';
const EMPRESA = '00000000-0000-0000-0000-0000000000aa';
const ENCF = 'E320000000001';
const BASE = 'https://ecf.api.mseller.app/TesteCF';

// Respuesta JSON de MSeller.
const res = (status, cuerpo) =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// `fetch` falso: atiende en orden lo que se le dio (una Response o un Error que
// se lanza) y guarda cada llamada.
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
  f.envios = () => llamadas.filter((l) => l.metodo === 'POST' && l.url === `${BASE}/documentos-ecf`);
  f.consultas = () => llamadas.filter((l) => l.metodo === 'GET');
  f.logins = () => llamadas.filter((l) => l.url.endsWith('/customer/authentication'));
  return f;
}

const RESPUESTA_ENVIO = {
  ecf: ENCF,
  internalTrackId: 'track-1',
  securityCode: 'fWCZCV',
  qr_url: 'https://ecf.dgii.gov.do/testecf/consultatimbre?encf=E320000000001&codigoseguridad=fWCZCV',
  signedDate: '30-10-2026 08:00:01',
};

// Factura de consumo de 1 línea con ITBIS aparte: 100 + 18 = 118.
const datos = (over = {}) => ({
  tipo: 32,
  encf: ENCF,
  fechaEmision: '2026-10-30',
  emisor: { rnc: '130000001', razonSocial: 'Supermercado Ejemplo SRL', direccion: 'Av. Principal #50' },
  comprador: null,
  itbisIncluido: false,
  aCredito: false,
  lineas: [{ nombre: 'Detergente', cantidad: 1, precio: 100, itbis: true, servicio: false }],
  totalGuardado: 118,
  itbisGuardado: 18,
  ...over,
});

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

// Dependencias falsas que anotan cada llamada. `over` pisa lo que la prueba necesita.
function armar({ intentos = 1, respuestas = [], datos: d = datos(), cred = credenciales(), over = {} } = {}) {
  const reg = { reservar: [], cargarDatos: [], leerCredenciales: [], guardarSesion: [], registrar: [], sumarUso: [] };
  const f = fetchFalso(...respuestas);
  const deps = {
    reservar: async (id) => {
      reg.reservar.push(id);
      return { id: DOC_ID, companyId: EMPRESA, encf: ENCF, ambiente: 'TesteCF', intentos };
    },
    cargarDatos: async (doc) => {
      reg.cargarDatos.push(doc);
      return d;
    },
    leerCredenciales: async (empresa, ambiente) => {
      reg.leerCredenciales.push([empresa, ambiente]);
      return cred;
    },
    guardarSesion: async (empresa, ambiente, sesion) => {
      reg.guardarSesion.push({ empresa, ambiente, sesion });
    },
    registrar: async (id, cambio) => {
      reg.registrar.push({ id, cambio });
    },
    sumarUso: async (empresa, requests, comprobantes) => {
      reg.sumarUso.push([empresa, requests, comprobantes]);
    },
    fetch: f,
    ahora: () => AHORA,
    ...over,
  };
  return { deps, reg, f };
}

// Lo único que se registró (y que fue una sola vez).
function unico(reg) {
  assert.equal(reg.registrar.length, 1, `se esperaba 1 registro y hubo ${reg.registrar.length}`);
  assert.equal(reg.registrar[0].id, DOC_ID);
  return reg.registrar[0].cambio;
}

// Nada de lo que sale (registros, resultado, uso) lleva un secreto.
function sinSecretos(reg, resultado) {
  const todo = JSON.stringify([reg.registrar, reg.sumarUso, resultado]);
  for (const s of SECRETOS) assert.ok(!todo.includes(s), `se coló un secreto: ${s.slice(0, 12)}...`);
}

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test('emite y devuelve el QR', async () => {
  const { deps, reg, f } = armar({ respuestas: [res(200, RESPUESTA_ENVIO)] });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.deepEqual(r, {
    estado: 'recibido',
    encf: ENCF,
    qrUrl: RESPUESTA_ENVIO.qr_url,
    securityCode: 'fWCZCV',
    signedAt: '30-10-2026 08:00:01',
  });

  // Una sola llamada: el primer intento no consulta antes de enviar.
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].url, `${BASE}/documentos-ecf`);
  assert.equal(f.llamadas[0].headers.get('authorization'), `Bearer ${ID_TOKEN}`);
  assert.equal(f.llamadas[0].headers.get('x-api-key'), API_KEY);
  assert.equal(f.llamadas[0].cuerpo.ECF.Encabezado.IdDoc.eNCF, ENCF);

  const c = unico(reg);
  assert.equal(c.estado, 'recibido');
  assert.equal(c.qr_url, RESPUESTA_ENVIO.qr_url);
  assert.equal(c.security_code, 'fWCZCV');
  assert.equal(c.signed_at, '30-10-2026 08:00:01');
  assert.equal(c.internal_track_id, 'track-1');
  assert.deepEqual(c.request_json, f.llamadas[0].cuerpo, 'se guarda copia de lo enviado');
  assert.equal(c.ultimo_error, null);
  assert.equal(c.enviado_at, AHORA.toISOString());
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null, 'al salir de enviando se suelta la reserva');

  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 1]]);
  assert.deepEqual(reg.leerCredenciales, [[EMPRESA, 'TesteCF']]);
  assert.equal(reg.guardarSesion.length, 0, 'la sesión guardada servía: no hay nada que guardar');
  sinSecretos(reg, r);
});

test('una sesión nueva se guarda antes de enviar', async () => {
  const { deps, reg, f } = armar({
    cred: credenciales({ idToken: null, idTokenVence: null, refreshToken: null, sub: null }),
    respuestas: [res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH }), res(200, RESPUESTA_ENVIO)],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(r.estado, 'recibido');
  assert.equal(f.logins().length, 1);
  assert.deepEqual(f.logins()[0].cuerpo, { email: 'caja@ejemplo.com', password: PASSWORD });
  assert.equal(reg.guardarSesion.length, 1);
  assert.equal(reg.guardarSesion[0].empresa, EMPRESA);
  assert.equal(reg.guardarSesion[0].ambiente, 'TesteCF');
  assert.equal(reg.guardarSesion[0].sesion.idToken, ID_TOKEN_NUEVO);
  assert.equal(reg.guardarSesion[0].sesion.refreshToken, REFRESH);
  assert.equal(f.envios()[0].headers.get('authorization'), `Bearer ${ID_TOKEN_NUEVO}`);
  // Iniciar sesión no cuenta como request; el envío sí.
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 1]]);
});

test('2xx sin código ni QR: queda recibido, sin reenviar y sin esos campos', async () => {
  // R14: un 2xx significa que MSeller lo recibió; reenviar duplicaría el comprobante.
  const { deps, reg, f } = armar({ respuestas: [res(200, {})] });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.deepEqual(r, { estado: 'recibido', encf: ENCF });
  assert.equal(f.envios().length, 1);
  const c = unico(reg);
  assert.equal(c.estado, 'recibido');
  for (const k of ['qr_url', 'security_code', 'signed_at', 'internal_track_id']) {
    assert.ok(!(k in c), `${k} va vacío (sin la clave) para que la fila quede en null`);
  }
  assert.ok(c.request_json);
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 1]]);
});

// ---------------------------------------------------------------------------
// Reintentos: antes de reenviar se consulta
// ---------------------------------------------------------------------------

test('reintento consulta antes de enviar', async () => {
  // Review Focus 3: el envío anterior pudo llegar a MSeller aunque no vimos la
  // respuesta. Si MSeller ya lo tiene, no se manda otra vez el mismo e-NCF.
  const { deps, reg, f } = armar({
    intentos: 2,
    respuestas: [
      res(200, {
        status: 'Aceptado',
        securityCode: 'fWCZCV',
        qr_url: RESPUESTA_ENVIO.qr_url,
        internalTrackId: 'track-1',
        signedDate: '30-10-2026 08:00:01',
        dgiiResponse: [JSON.stringify({ mensajes: [{ valor: '', codigo: 0 }] })],
      }),
    ],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 0, 'no se reenvía lo que MSeller ya tiene');
  assert.equal(f.consultas().length, 1);
  assert.equal(f.consultas()[0].url, `${BASE}/documentos-ecf?ecf=${ENCF}`);

  const c = unico(reg);
  assert.equal(c.estado, 'aceptado', 'se registra el estado que dio la consulta');
  assert.equal(c.security_code, 'fWCZCV');
  assert.equal(c.qr_url, RESPUESTA_ENVIO.qr_url);
  assert.equal(c.signed_at, '30-10-2026 08:00:01');
  assert.equal(c.internal_track_id, 'track-1');
  assert.deepEqual(c.mensajes_dgii, []);
  assert.equal(c.ultimo_error, null);
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null);
  assert.ok(!('request_json' in c), 'no se guarda como enviado algo que esta vez no se envió');

  assert.deepEqual(r, {
    estado: 'aceptado',
    encf: ENCF,
    qrUrl: RESPUESTA_ENVIO.qr_url,
    securityCode: 'fWCZCV',
    signedAt: '30-10-2026 08:00:01',
  });
  // 1 request de la consulta; el comprobante se cuenta porque nunca se contó.
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 1]]);
  sinSecretos(reg, r);
});

test('reintento envía si MSeller no lo tiene', async () => {
  const { deps, reg, f } = armar({
    intentos: 2,
    respuestas: [res(404, { message: 'no existe' }), res(200, RESPUESTA_ENVIO)],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(r.estado, 'recibido');
  assert.equal(f.consultas().length, 1);
  assert.equal(f.envios().length, 1);
  assert.deepEqual(
    f.llamadas.map((l) => l.metodo),
    ['GET', 'POST'],
    'primero se consulta y solo después se envía',
  );
  const c = unico(reg);
  assert.equal(c.estado, 'recibido');
  assert.ok(c.request_json);
  // La consulta y el envío gastan un request cada una; un solo comprobante.
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 2, 1]]);
});

test('"No encontrado" en la consulta también manda a enviar', async () => {
  const { deps, f } = armar({
    intentos: 3,
    respuestas: [res(200, { status: 'No encontrado' }), res(200, RESPUESTA_ENVIO)],
  });
  const r = await emitirDocumento(DOC_ID, deps);
  assert.equal(r.estado, 'recibido');
  assert.equal(f.envios().length, 1);
});

test('si la consulta encuentra un rechazo, lo registra con los mensajes y no reenvía', async () => {
  const mensajes = [{ codigo: 1920, valor: 'El campo MontoGravadoTotal no cuadra' }];
  const { deps, reg, f } = armar({
    intentos: 2,
    respuestas: [res(200, { status: 'Rechazado', dgiiResponse: [JSON.stringify({ mensajes })] })],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 0);
  const c = unico(reg);
  assert.equal(c.estado, 'rechazado');
  assert.deepEqual(c.mensajes_dgii, mensajes);
  assert.equal(c.ultimo_error, 'El campo MontoGravadoTotal no cuadra');
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null);
  assert.equal(r.estado, 'rechazado');
  assert.equal(r.error, 'El campo MontoGravadoTotal no cuadra');
});

test('si la consulta falla por red, vuelve a por_enviar y no envía a ciegas', async () => {
  const { deps, reg, f } = armar({ intentos: 2, respuestas: [new TypeError('fetch failed')] });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 0, 'sin saber si MSeller lo tiene, no se reenvía');
  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.proximo_intento_at, minutos(2).toISOString(), 'intento 2: espera 2 minutos');
  assert.match(c.ultimo_error, /Sin respuesta de MSeller/);
  assert.equal(r.estado, 'por_enviar');
});

// ---------------------------------------------------------------------------
// Fallos del envío
// ---------------------------------------------------------------------------

test('401 inicia sesión de nuevo y reintenta una vez', async () => {
  const { deps, reg, f } = armar({
    respuestas: [
      res(401, { message: 'Unauthorized' }),
      res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH }),
      res(200, RESPUESTA_ENVIO),
    ],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(r.estado, 'recibido');
  assert.equal(f.envios().length, 2);
  assert.equal(f.logins().length, 1);
  // El login es con la contraseña: no queda sesión ni refreshToken que reutilizar.
  assert.deepEqual(f.logins()[0].cuerpo, { email: 'caja@ejemplo.com', password: PASSWORD });
  assert.equal(f.envios()[0].headers.get('authorization'), `Bearer ${ID_TOKEN}`);
  assert.equal(f.envios()[1].headers.get('authorization'), `Bearer ${ID_TOKEN_NUEVO}`);

  assert.equal(reg.guardarSesion.length, 1, 'la sesión nueva se guarda');
  assert.equal(reg.guardarSesion[0].sesion.idToken, ID_TOKEN_NUEVO);
  assert.equal(unico(reg).estado, 'recibido');
  // El 401 no gasta cupo: solo cuenta el envío que sí se atendió.
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 1]]);
  sinSecretos(reg, r);
});

test('un segundo 401 no se vuelve a intentar: por_enviar', async () => {
  const { deps, reg, f } = armar({
    respuestas: [res(401, 'no'), res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH }), res(401, 'no')],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 2, 'se reintenta una sola vez');
  assert.equal(f.logins().length, 1);
  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.proximo_intento_at, minutos(1).toISOString());
  assert.match(c.ultimo_error, /autenticación/);
  assert.equal(r.estado, 'por_enviar');
  assert.deepEqual(reg.sumarUso, [], 'ninguna respuesta de autenticación gasta cupo');
  sinSecretos(reg, r);
});

test('si el login con la contraseña falla, queda por_enviar (no error_datos)', async () => {
  // Una contraseña mala se arregla en la configuración; el comprobante está bien.
  const { deps, reg, f } = armar({
    cred: credenciales({ idToken: null, idTokenVence: null, refreshToken: null }),
    respuestas: [res(400, { message: `credenciales inválidas ${PASSWORD}` })],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 0);
  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.ok(c.proximo_intento_at);
  assert.equal(r.estado, 'por_enviar');
  sinSecretos(reg, r);
});

test('429 deja sin_cupo', async () => {
  const { deps, reg, f } = armar({ respuestas: [res(429, { message: 'Too Many Requests' })] });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 1, 'no se insiste');
  const c = unico(reg);
  assert.equal(c.estado, 'sin_cupo');
  assert.match(c.ultimo_error, /cupo/i);
  // Pinneado: el cron decide si re-encola un sin_cupo por su estado_at.
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null);
  assert.equal(r.estado, 'sin_cupo');
  assert.equal(r.encf, ENCF);
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]], 'respondió 429: un request, ningún comprobante');
});

test('400 deja error_datos con el mensaje', async () => {
  const mensaje = 'El campo MontoGravadoTotal del área Totales de la sección Encabezado no es válido';
  const { deps, reg, f } = armar({ respuestas: [res(400, mensaje)] });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 1, 'sin reintento automático');
  const c = unico(reg);
  assert.equal(c.estado, 'error_datos');
  assert.equal(c.ultimo_error, mensaje);
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null);
  // Para soporte: lo que MSeller no aceptó.
  assert.deepEqual(c.request_json, f.llamadas[0].cuerpo);
  assert.equal(r.estado, 'error_datos');
  assert.equal(r.error, mensaje);
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]]);
});

test('red deja por_enviar con próximo intento', async () => {
  const { deps, reg } = armar({ intentos: 1, respuestas: [new TypeError('fetch failed')] });
  const r = await emitirDocumento(DOC_ID, deps);

  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.proximo_intento_at, minutos(1).toISOString(), 'primer intento: espera 1 minuto');
  assert.match(c.ultimo_error, /Sin respuesta de MSeller/);
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null);
  assert.ok(!('request_json' in c), 'no se confirmó el envío: no se guarda como enviado');
  assert.equal(r.estado, 'por_enviar');
  assert.deepEqual(reg.sumarUso, [], 'sin respuesta HTTP no hay request que contar');
});

test('un 5xx deja por_enviar y la espera crece con los intentos', async () => {
  const { deps, reg } = armar({
    // Con intentos 3 primero se consulta (404: MSeller no lo tiene) y luego se envía.
    intentos: 3,
    respuestas: [res(404, 'no'), res(503, 'caído')],
  });
  const r = await emitirDocumento(DOC_ID, deps);

  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.proximo_intento_at, minutos(5).toISOString(), 'intento 3: espera 5 minutos');
  assert.match(c.ultimo_error, /503/);
  assert.equal(r.estado, 'por_enviar');
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 2, 0]]);
});

test('un 2xx con un cuerpo que no es un objeto se trata como fallo del servidor', async () => {
  // MSeller respondió pero no sabemos qué: por_enviar y, como intentos pasa de 1,
  // el próximo intento consulta antes de enviar.
  const { deps, reg } = armar({ respuestas: [res(200, '[1,2]')] });
  const r = await emitirDocumento(DOC_ID, deps);

  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.proximo_intento_at, minutos(1).toISOString());
  assert.match(c.ultimo_error, /sin el formato esperado/);
  assert.equal(r.estado, 'por_enviar');
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]]);
});

// ---------------------------------------------------------------------------
// Antes de llamar a MSeller
// ---------------------------------------------------------------------------

test('descuadre no llama a MSeller', async () => {
  const { deps, reg, f } = armar({ datos: datos({ totalGuardado: 120 }) });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.llamadas.length, 0);
  assert.equal(reg.leerCredenciales.length, 0, 'ni siquiera se descifran las credenciales');
  const c = unico(reg);
  assert.equal(c.estado, 'error_datos');
  assert.match(c.ultimo_error, /no cuadra/);
  assert.equal(c.estado_at, AHORA.toISOString());
  assert.equal(c.reservado_hasta, null);
  assert.equal(r.estado, 'error_datos');
  assert.match(r.error, /no cuadra/);
  assert.equal(r.encf, ENCF);
  assert.deepEqual(reg.sumarUso, []);
});

test('documento ocupado no hace nada', async () => {
  const { deps, reg, f } = armar({
    over: {
      reservar: async (id) => {
        reg.reservar.push(id);
        return null;
      },
    },
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.deepEqual(r, { estado: 'ocupado' });
  assert.deepEqual(reg.reservar, [DOC_ID]);
  assert.equal(f.llamadas.length, 0);
  assert.equal(reg.cargarDatos.length, 0);
  assert.equal(reg.leerCredenciales.length, 0);
  assert.equal(reg.registrar.length, 0);
  assert.equal(reg.sumarUso.length, 0);
});

test('un dato que falta (ErrorDatosEcf) deja error_datos y no llama a MSeller', async () => {
  const { deps, reg, f } = armar({
    over: {
      cargarDatos: async () => {
        throw new ErrorDatosEcf('La empresa no tiene configurada la facturación electrónica.');
      },
    },
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.llamadas.length, 0);
  const c = unico(reg);
  assert.equal(c.estado, 'error_datos');
  assert.equal(c.ultimo_error, 'La empresa no tiene configurada la facturación electrónica.');
  assert.equal(r.estado, 'error_datos');
});

test('un error inesperado al cargar los datos deja por_enviar', async () => {
  const { deps, reg, f } = armar({
    over: {
      cargarDatos: async () => {
        throw new Error('canceling statement due to statement timeout');
      },
    },
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(f.llamadas.length, 0);
  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.proximo_intento_at, minutos(1).toISOString());
  assert.equal(c.ultimo_error, 'canceling statement due to statement timeout');
  assert.equal(r.estado, 'por_enviar');
});

test('sin credenciales guardadas queda por_enviar con el motivo', async () => {
  const { deps, reg, f } = armar({
    over: {
      leerCredenciales: async () => {
        throw new Error('La empresa no tiene credenciales de MSeller para TesteCF.');
      },
    },
  });
  await emitirDocumento(DOC_ID, deps);

  assert.equal(f.llamadas.length, 0);
  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.match(c.ultimo_error, /credenciales/);
});

// ---------------------------------------------------------------------------
// Robustez: lo que no puede pasar
// ---------------------------------------------------------------------------

test('si guardar la sesión falla, no se envía y queda por_enviar', async () => {
  const { deps, reg, f } = armar({
    cred: credenciales({ idToken: null, idTokenVence: null, refreshToken: null }),
    respuestas: [res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH })],
    over: {
      guardarSesion: async () => {
        throw new Error('fallo guardando');
      },
    },
  });
  await emitirDocumento(DOC_ID, deps);

  assert.equal(f.envios().length, 0);
  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.equal(c.ultimo_error, 'fallo guardando');
});

test('si no se puede contar el uso, el comprobante igual queda recibido', async () => {
  const { deps, reg } = armar({
    respuestas: [res(200, RESPUESTA_ENVIO)],
    over: {
      sumarUso: async () => {
        throw new Error('base caída');
      },
    },
  });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(r.estado, 'recibido');
  assert.equal(unico(reg).estado, 'recibido');
});

test('si no se puede registrar lo recibido, el error sale y no se pisa con por_enviar', async () => {
  // Quedará enviando hasta que venza la reserva; el siguiente intento consulta
  // antes de enviar (intentos > 1), así que no se duplica.
  const intentos = [];
  const { deps, reg } = armar({
    respuestas: [res(200, RESPUESTA_ENVIO)],
    over: {
      registrar: async (id, cambio) => {
        intentos.push(cambio.estado);
        throw new Error('base caída');
      },
    },
  });
  await assert.rejects(() => emitirDocumento(DOC_ID, deps), /base caída/);

  assert.deepEqual(intentos, ['recibido']);
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]], 'el comprobante no se cuenta hasta que quede registrado');
});

test('con credenciales cargadas, ningún secreto sale en ultimo_error', async () => {
  const { deps, reg } = armar({
    cred: credenciales({ idToken: null, idTokenVence: null, refreshToken: null }),
    respuestas: [res(200, { idToken: ID_TOKEN_NUEVO, refreshToken: REFRESH })],
    over: {
      guardarSesion: async () => {
        throw new Error(`no se pudo guardar ${PASSWORD} / ${API_KEY} / ${ID_TOKEN_NUEVO} / ${REFRESH}`);
      },
    },
  });
  const r = await emitirDocumento(DOC_ID, deps);

  const c = unico(reg);
  assert.equal(c.estado, 'por_enviar');
  assert.match(c.ultimo_error, /\*\*\*/);
  sinSecretos(reg, r);
});

test('un 400 que repite un secreto no lo guarda ni en ultimo_error ni en el resultado', async () => {
  const { deps, reg } = armar({ respuestas: [res(400, `rechazado, token ${ID_TOKEN} key ${API_KEY}`)] });
  const r = await emitirDocumento(DOC_ID, deps);

  assert.equal(unico(reg).estado, 'error_datos');
  sinSecretos(reg, r);
});

// ---------------------------------------------------------------------------
// completarDocumento: llenar código y QR que faltaron (R14)
// ---------------------------------------------------------------------------

const docVigente = (over = {}) => ({
  id: DOC_ID,
  companyId: EMPRESA,
  encf: ENCF,
  ambiente: 'TesteCF',
  estado: 'recibido',
  ...over,
});

const depsConsulta = (respuestas, over = {}) => {
  const { deps, reg, f } = armar({ respuestas, over });
  return { deps, reg, f };
};

test('completarDocumento llena código, QR y fecha de firma si MSeller ya los tiene', async () => {
  const { deps, reg, f } = depsConsulta([
    res(200, {
      status: 'En Cola',
      securityCode: 'fWCZCV',
      qr_url: RESPUESTA_ENVIO.qr_url,
      internalTrackId: 'track-1',
      signedDate: '30-10-2026 08:00:01',
    }),
  ]);
  const llenado = await completarDocumento(docVigente(), deps);

  assert.equal(llenado, true);
  assert.equal(f.consultas().length, 1);
  assert.equal(f.envios().length, 0, 'solo consulta: nunca reenvía');
  const c = unico(reg);
  assert.equal(c.estado, 'recibido', 'el estado no cambia: de eso se ocupa el seguimiento');
  assert.equal(c.security_code, 'fWCZCV');
  assert.equal(c.qr_url, RESPUESTA_ENVIO.qr_url);
  assert.equal(c.signed_at, '30-10-2026 08:00:01');
  assert.equal(c.internal_track_id, 'track-1');
  assert.ok(!('estado_at' in c), 'el estado no cambió: no se toca estado_at');
  assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]]);
  assert.equal(reg.reservar.length, 0, 'no reserva ni cuenta intento');
});

test('completarDocumento no escribe nada si MSeller tampoco los tiene', async () => {
  for (const respuesta of [res(404, 'no'), res(200, { status: 'En Cola' })]) {
    const { deps, reg } = depsConsulta([respuesta]);
    assert.equal(await completarDocumento(docVigente(), deps), false);
    assert.equal(reg.registrar.length, 0);
    assert.deepEqual(reg.sumarUso, [[EMPRESA, 1, 0]], 'la consulta respondió: gastó un request');
  }
});

test('completarDocumento es de mejor esfuerzo: un fallo no lanza', async () => {
  const { deps, reg } = depsConsulta([new TypeError('fetch failed')]);
  assert.equal(await completarDocumento(docVigente(), deps), false);
  assert.equal(reg.registrar.length, 0);

  const { deps: deps2 } = depsConsulta([], {
    leerCredenciales: async () => {
      throw new Error('sin credenciales');
    },
  });
  assert.equal(await completarDocumento(docVigente(), deps2), false);
});

// ---------------------------------------------------------------------------
// datosEcf: lo que se le pasa al armado a partir de las filas leídas
// ---------------------------------------------------------------------------

const EMISOR = { rnc: '130000001', razonSocial: 'Supermercado Ejemplo SRL', direccion: 'Av. Principal #50' };
const ZONA = 'America/Santo_Domingo';
const LINEAS = [{ nombre: 'Detergente', cantidad: 1, precio: 100, itbis: true, servicio: false }];

const entrada = (over = {}) => ({
  tipo: 32,
  encf: ENCF,
  zona: ZONA,
  emisor: EMISOR,
  venta: {
    created_at: '2026-10-30T15:00:00Z',
    total: 118,
    itbis_amount: 18,
    itbis_included: false,
    payment_status: 'paid',
  },
  lineas: LINEAS,
  cliente: null,
  ...over,
});

test('datosEcf: el día del comprobante es el de RD aunque en UTC ya sea el siguiente', () => {
  // Review Focus 1: venta a las 11:30 de la noche en RD = 03:30 UTC del día siguiente.
  const d = datosEcf(entrada({ venta: { ...entrada().venta, created_at: '2026-10-31T03:30:00Z' } }));
  assert.equal(d.fechaEmision, '2026-10-30');
});

test('datosEcf: factura de consumo pagada, sin cliente', () => {
  const d = datosEcf(entrada());
  assert.equal(d.tipo, 32);
  assert.equal(d.encf, ENCF);
  assert.equal(d.fechaEmision, '2026-10-30');
  assert.equal(d.comprador, null);
  assert.equal(d.aCredito, false);
  assert.equal(d.fechaLimitePago, undefined);
  assert.equal(d.itbisIncluido, false);
  assert.equal(d.totalGuardado, 118);
  assert.equal(d.itbisGuardado, 18);
  assert.equal(d.referencia, undefined);
  assert.equal(d.vencimientoSecuencia, undefined);
  assert.equal(armarEcf(d).ok, true);
});

test('datosEcf: el cliente pasa con su RNC y nombre; sin RNC queda sin identificar', () => {
  const con = datosEcf(entrada({ tipo: 31, cliente: { name: 'Ferretería Ana SRL', rnc: '131-23456-7' } }));
  assert.deepEqual(con.comprador, { rnc: '131-23456-7', nombre: 'Ferretería Ana SRL' });

  const sin = datosEcf(entrada({ cliente: { name: 'Juan', rnc: null } }));
  assert.deepEqual(sin.comprador, { rnc: '', nombre: 'Juan' });
  // Un E32 con cliente sin RNC sale como consumidor final; un E31 no se arma.
  assert.equal(armarEcf(sin).ok, true);
  assert.equal(armarEcf({ ...sin, tipo: 31, vencimientoSecuencia: '2028-12-31' }).ok, false);
});

test('datosEcf: venta fiada lleva la venta más 30 días como fecha límite de pago', () => {
  const d = datosEcf(entrada({ venta: { ...entrada().venta, payment_status: 'credit' } }));
  assert.equal(d.aCredito, true);
  assert.equal(d.fechaLimitePago, '2026-11-29');
});

test('datosEcf: venta a plazos lleva la fecha de la última cuota', () => {
  const d = datosEcf(
    entrada({ venta: { ...entrada().venta, payment_status: 'in_financing' }, ultimaCuota: '2027-03-15' }),
  );
  assert.equal(d.aCredito, true);
  assert.equal(d.fechaLimitePago, '2027-03-15');

  // A plazos sin cuotas guardadas: cae a la venta más 30 días.
  const sinCuotas = datosEcf(
    entrada({ venta: { ...entrada().venta, payment_status: 'in_financing' }, ultimaCuota: null }),
  );
  assert.equal(sinCuotas.fechaLimitePago, '2026-11-29');
});

test('datosEcf: la nota de crédito usa su fecha y sus totales, va de contado y referencia la venta', () => {
  const d = datosEcf(
    entrada({
      tipo: 34,
      encf: 'E340000000001',
      // La venta original era fiada: la nota no lleva fecha límite de pago (R13).
      venta: { ...entrada().venta, payment_status: 'credit' },
      nota: { created_at: '2026-11-05T16:00:00Z', total: 118, itbis_amount: 18, encfOriginal: ENCF },
    }),
  );
  assert.equal(d.tipo, 34);
  assert.equal(d.aCredito, false);
  assert.equal(d.fechaLimitePago, undefined);
  assert.equal(d.fechaEmision, '2026-11-05', 'la fecha de la nota, no la de la venta');
  assert.deepEqual(d.referencia, { encf: ENCF, fechaEmision: '2026-10-30', masDe30Dias: false });
  assert.equal(d.totalGuardado, 118);
  assert.equal(d.itbisGuardado, 18);

  const armado = armarEcf(d);
  assert.equal(armado.ok, true, armado.ok ? '' : armado.error);
  assert.equal(armado.json.ECF.InformacionReferencia.NCFModificado, ENCF);
  assert.equal(armado.json.ECF.Encabezado.IdDoc.IndicadorNotaCredito, 0);
  assert.equal(armado.json.ECF.Encabezado.IdDoc.TipoPago, 1);
});

test('datosEcf: masDe30Dias es verdadero desde el día 31, no antes', () => {
  const nota = (created_at) => ({ created_at, total: 118, itbis_amount: 18, encfOriginal: ENCF });
  const base = { tipo: 34, venta: { ...entrada().venta, created_at: '2026-10-01T15:00:00Z' } };
  // 1 de octubre -> 31 de octubre son 30 días; -> 1 de noviembre son 31.
  assert.equal(datosEcf(entrada({ ...base, nota: nota('2026-10-31T15:00:00Z') })).referencia.masDe30Dias, false);
  assert.equal(datosEcf(entrada({ ...base, nota: nota('2026-11-01T15:00:00Z') })).referencia.masDe30Dias, true);
});

test('datosEcf: un E34 sin nota no se arma', () => {
  assert.throws(() => datosEcf(entrada({ tipo: 34 })), /nota de crédito/);
});

test('datosEcf: pasa el vencimiento de la secuencia cuando lo hay', () => {
  assert.equal(datosEcf(entrada({ tipo: 31, vencimientoSecuencia: '2028-12-31' })).vencimientoSecuencia, '2028-12-31');
});

test('vencimientoDeSecuencia busca el prefijo y el rango que contienen el número', () => {
  const secuencias = [
    { prefix: 'E31', range_from: 1, range_to: 1000, expires_at: '2027-12-31' },
    { prefix: 'E32', range_from: 1, range_to: 500, expires_at: '2027-06-30' },
    { prefix: 'E32', range_from: 501, range_to: 2000, expires_at: '2028-12-31' },
  ];
  assert.equal(vencimientoDeSecuencia('E320000000001', secuencias), '2027-06-30');
  assert.equal(vencimientoDeSecuencia('E320000000500', secuencias), '2027-06-30');
  assert.equal(vencimientoDeSecuencia('E320000000501', secuencias), '2028-12-31');
  assert.equal(vencimientoDeSecuencia('E310000000999', secuencias), '2027-12-31');
  assert.equal(vencimientoDeSecuencia('E320000009999', secuencias), undefined, 'fuera de todo rango');
  assert.equal(vencimientoDeSecuencia('E440000000001', secuencias), undefined, 'otro prefijo');
  // PostgREST puede mandar los bigint como texto.
  assert.equal(
    vencimientoDeSecuencia('E310000000010', [
      { prefix: 'E31', range_from: '1', range_to: '100', expires_at: '2030-01-01' },
    ]),
    '2030-01-01',
  );
  assert.equal(
    vencimientoDeSecuencia('E310000000010', [{ prefix: 'E31', range_from: 1, range_to: 100, expires_at: null }]),
    undefined,
    'una secuencia sin vencimiento no inventa fecha',
  );
});

test('sumarDias y diasEntre cruzan mes, año y bisiesto', () => {
  assert.equal(sumarDias('2026-10-30', 30), '2026-11-29');
  assert.equal(sumarDias('2026-12-20', 30), '2027-01-19');
  assert.equal(sumarDias('2028-02-01', 30), '2028-03-02');
  assert.equal(diasEntre('2026-10-01', '2026-10-31'), 30);
  assert.equal(diasEntre('2027-12-31', '2028-01-01'), 1);
  assert.equal(diasEntre('2028-02-28', '2028-03-01'), 2);
  assert.equal(diasEntre('2026-11-05', '2026-11-01'), -4);
});
