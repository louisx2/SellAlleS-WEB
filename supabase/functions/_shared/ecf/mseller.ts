// Cliente de la API REST de MSeller (módulo puro: no importa nada y recibe
// `fetch` como parámetro, así las pruebas lo reemplazan por uno falso).
//
// Lo comparten las Edge Functions (Deno) y las pruebas de `npm test` (Node),
// que lo cargan quitando los tipos: por eso solo usa sintaxis borrable (nada de
// enum, namespace ni parameter properties), sin APIs de Node ni de Deno.
//
// Los secretos (contraseña, API key, tokens) nunca deben salir en un mensaje de
// error: lo que devuelva el servidor se limpia antes de ponerlo en uno.

export type Ambiente = 'TesteCF' | 'CerteCF' | 'eCF';

export type EstadoLocal =
  | 'recibido'
  | 'aceptado'
  | 'aceptado_condicional'
  | 'rechazado'
  | 'error_datos'
  | 'no_encontrado';

export type TipoFallo = 'red' | 'auth' | 'cupo' | 'datos' | 'no_encontrado' | 'servidor';

export class MsellerError extends Error {
  tipo: TipoFallo;
  status?: number;

  constructor(tipo: TipoFallo, mensaje: string, status?: number) {
    super(mensaje);
    this.name = 'MsellerError';
    this.tipo = tipo;
    this.status = status;
  }
}

export interface Sesion {
  idToken: string;
  idTokenVence: string; // ISO
  refreshToken: string | null;
  sub: string;
}

export interface Credenciales {
  email: string;
  password: string;
  apiKey: string;
  refreshToken: string | null;
  sub: string | null;
  idToken: string | null;
  idTokenVence: string | null;
}

export interface RespuestaEnvio {
  ecf: string;
  internalTrackId: string;
  securityCode: string;
  qrUrl: string;
  signedDate: string;
}

export interface EstadoRemoto {
  ecf: string;
  estado: EstadoLocal;
  mensajes: Array<{ codigo: number; valor: string }>;
  securityCode?: string;
  qrUrl?: string;
  internalTrackId?: string;
  // Fecha de firma (dd-mm-aaaa hh:mm:ss) si la consulta la trae; igual que en el envío.
  signedDate?: string;
}

export const MSELLER_BASE = 'https://ecf.api.mseller.app';

// El idToken dura 60 minutos; se da por vencido a los 55 para no usarlo al límite.
const VIGENCIA_SESION_MIN = 55;
// Con menos de 1 minuto de vida, el token guardado ya no se usa.
const MARGEN_MS = 60_000;
const PLAZO_MS = 15_000;
const MAX_LOTE = 100;
const MAX_MENSAJE_DATOS = 500;
const MAX_DETALLE = 200;
// Minutos de espera tras el intento 1, 2, 3, 4 y 5; desde el 6 son 60.
const ESPERAS_MIN = [1, 2, 5, 10, 30];
const ESPERA_MAX_MIN = 60;

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null;

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Cambia cada secreto que aparezca en `t` por `***`. */
function limpiar(t: string, secretos: string[]): string {
  let r = t;
  for (const s of secretos) {
    if (s.length >= 4) r = r.split(s).join('***');
  }
  return r;
}

function descripcionDe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function errorHttp(status: number, cuerpo: string, secretos: string[]): MsellerError {
  const limpio = limpiar(cuerpo, secretos).trim();
  const detalle = limpio === '' ? '' : `: ${limpio.slice(0, MAX_DETALLE)}`;
  if (status === 401 || status === 403) {
    return new MsellerError('auth', `MSeller rechazó la autenticación (${status})${detalle}`, status);
  }
  if (status === 429) {
    return new MsellerError('cupo', `Se agotó el cupo de peticiones de MSeller (429)${detalle}`, status);
  }
  if (status === 404) {
    return new MsellerError('no_encontrado', `MSeller no encontró lo pedido (404)${detalle}`, status);
  }
  // 400 y 422, y cualquier otro 4xx (409, etc.): MSeller no aceptó lo enviado.
  if (status >= 400 && status < 500) {
    return new MsellerError(
      'datos',
      limpio === '' ? `MSeller rechazó los datos (${status})` : limpio.slice(0, MAX_MENSAJE_DATOS),
      status,
    );
  }
  return new MsellerError('servidor', `MSeller respondió ${status}${detalle}`, status);
}

interface Peticion {
  metodo: 'GET' | 'POST';
  url: string;
  encabezados: Record<string, string>;
  cuerpo?: unknown;
  secretos: string[];
}

/** Hace la llamada y devuelve el JSON de una respuesta 2xx; lo demás lanza MsellerError. */
async function pedir(f: typeof fetch, p: Peticion): Promise<unknown> {
  let status: number;
  let ok: boolean;
  let contenido: string;
  try {
    const r = await f(p.url, {
      method: p.metodo,
      headers: p.encabezados,
      body: p.cuerpo === undefined ? undefined : JSON.stringify(p.cuerpo),
      signal: AbortSignal.timeout(PLAZO_MS),
    });
    status = r.status;
    ok = r.ok;
    contenido = await r.text();
  } catch (e) {
    const detalle = limpiar(descripcionDe(e), p.secretos).slice(0, MAX_DETALLE);
    throw new MsellerError('red', `Sin respuesta de MSeller (${detalle})`);
  }

  if (!ok) throw errorHttp(status, contenido, p.secretos);
  if (contenido.trim() === '') return null;
  try {
    return JSON.parse(contenido);
  } catch {
    throw new MsellerError('servidor', `MSeller respondió algo que no es JSON (${status})`, status);
  }
}

function encabezadosApi(s: Sesion, apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${s.idToken}`,
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
  };
}

function llamarApi(
  f: typeof fetch,
  metodo: 'GET' | 'POST',
  url: string,
  s: Sesion,
  apiKey: string,
  cuerpo?: unknown,
): Promise<unknown> {
  return pedir(f, { metodo, url, encabezados: encabezadosApi(s, apiKey), cuerpo, secretos: [s.idToken, apiKey] });
}

const sinObjeto = (donde: string) => new MsellerError('servidor', `MSeller respondió ${donde} sin el formato esperado`);

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

/**
 * Lee el `sub` (el `username` que pide la renovación) del payload del idToken.
 * No valida la firma: la API valida el refreshToken al renovar.
 */
export function subDeIdToken(idToken: string): string {
  const parte = idToken.split('.')[1];
  if (parte) {
    try {
      // base64url -> base64 con relleno, y de ahí a UTF-8.
      const b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
      const binario = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
      const payload = objeto(JSON.parse(new TextDecoder().decode(bytes)));
      const sub = payload ? texto(payload.sub) : '';
      if (sub) return sub;
    } catch {
      // cae al error de abajo
    }
  }
  // El mensaje no incluye el token.
  throw new MsellerError('servidor', 'El idToken de MSeller no trae un sub legible');
}

function leerSub(idToken: string): string | null {
  try {
    return subDeIdToken(idToken);
  } catch {
    return null;
  }
}

/** POST /{ambiente}/customer/authentication; devuelve el cuerpo de la respuesta. */
async function autenticar(a: Ambiente, f: typeof fetch, cuerpo: Json, secretos: string[]): Promise<Json> {
  const j = await pedir(f, {
    metodo: 'POST',
    url: `${MSELLER_BASE}/${a}/customer/authentication`,
    encabezados: { 'Content-Type': 'application/json' },
    cuerpo,
    secretos,
  });
  const o = objeto(j);
  if (!o || !texto(o.idToken)) throw sinObjeto('la autenticación');
  return o;
}

/**
 * Devuelve una sesión que sirva ahora. Usa el idToken guardado si vence en más
 * de 1 minuto; si no, lo renueva con el refreshToken (y el sub como username), y
 * si la renovación no es aceptada, inicia sesión de nuevo con correo y contraseña.
 *
 * Para forzar un login nuevo basta pasar `idToken`, `idTokenVence` y
 * `refreshToken` en null: no queda nada que reutilizar ni renovar.
 */
export async function sesionVigente(
  c: Credenciales,
  ambiente: Ambiente,
  f: typeof fetch,
  ahora: Date,
): Promise<{ sesion: Sesion; nueva: boolean }> {
  const secretos = [c.password, c.apiKey, c.refreshToken ?? '', c.idToken ?? ''];
  const subGuardado = c.sub ?? (c.idToken ? leerSub(c.idToken) : null);
  const vence = new Date(ahora.getTime() + VIGENCIA_SESION_MIN * 60_000).toISOString();

  // 1. El token guardado todavía sirve.
  if (c.idToken && c.idTokenVence && subGuardado) {
    if (new Date(c.idTokenVence).getTime() - ahora.getTime() > MARGEN_MS) {
      return {
        sesion: { idToken: c.idToken, idTokenVence: c.idTokenVence, refreshToken: c.refreshToken, sub: subGuardado },
        nueva: false,
      };
    }
  }

  // 2. Renovar. La respuesta no trae refreshToken nuevo: se conserva el anterior.
  if (c.refreshToken && subGuardado) {
    try {
      const o = await autenticar(ambiente, f, { refreshToken: c.refreshToken, username: subGuardado }, secretos);
      return {
        sesion: { idToken: texto(o.idToken), idTokenVence: vence, refreshToken: c.refreshToken, sub: subGuardado },
        nueva: true,
      };
    } catch (e) {
      // Un refreshToken vencido o inválido se arregla con la contraseña; una
      // caída de red o del servidor no (ahí iniciar sesión tampoco ayudaría).
      const noAceptado = e instanceof MsellerError && (e.tipo === 'auth' || e.tipo === 'datos');
      if (!noAceptado) throw e;
    }
  }

  // 3. Iniciar sesión con correo y contraseña.
  const o = await autenticar(ambiente, f, { email: c.email, password: c.password }, secretos);
  const idToken = texto(o.idToken);
  return {
    sesion: { idToken, idTokenVence: vence, refreshToken: texto(o.refreshToken) || null, sub: subDeIdToken(idToken) },
    nueva: true,
  };
}

// ---------------------------------------------------------------------------
// Estados y mensajes
// ---------------------------------------------------------------------------

/** Estado de MSeller (`status`) a estado local. Lo desconocido cuenta como error. */
export function mapearEstado(status: string): EstadoLocal {
  switch (status.trim()) {
    case 'En Cola':
    case 'Enviado a la DGII':
    case 'En Proceso':
      return 'recibido';
    case 'Aceptado':
      return 'aceptado';
    case 'Aceptado Condicional':
      return 'aceptado_condicional';
    case 'Rechazado':
      return 'rechazado';
    case 'No encontrado':
      return 'no_encontrado';
    default:
      return 'error_datos';
  }
}

/**
 * Mensajes de la DGII. `dgiiResponse` es una lista de strings JSON (una por
 * respuesta recibida); vale la `mensajes` del último que la traiga. Se quitan
 * los de `valor` vacío (la DGII manda `{valor:'', codigo:0}` cuando no hay nada).
 */
export function extraerMensajes(dgiiResponse: string[] | undefined): Array<{ codigo: number; valor: string }> {
  let ultimos: unknown[] | null = null;
  for (const s of dgiiResponse ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      continue;
    }
    const o = objeto(parsed);
    if (o && Array.isArray(o.mensajes)) ultimos = o.mensajes;
  }

  const salida: Array<{ codigo: number; valor: string }> = [];
  for (const m of ultimos ?? []) {
    const o = objeto(m);
    if (!o) continue;
    const valor = texto(o.valor).trim();
    if (valor === '') continue;
    const codigo = Number(o.codigo);
    salida.push({ codigo: Number.isFinite(codigo) ? codigo : 0, valor });
  }
  return salida;
}

/** Cuándo volver a consultar un documento pendiente, según los intentos hechos. */
export function proximoIntento(intentos: number, ahora: Date): Date {
  const n = Math.max(1, Math.floor(intentos) || 1);
  const minutos = n > ESPERAS_MIN.length ? ESPERA_MAX_MIN : ESPERAS_MIN[n - 1];
  return new Date(ahora.getTime() + minutos * 60_000);
}

/** Arma el estado a partir de la respuesta de consulta (o de `data` en el lote). */
function estadoDesde(ecf: string, status: string, d: Json): EstadoRemoto {
  const dgii = Array.isArray(d.dgiiResponse) ? d.dgiiResponse.filter((x): x is string => typeof x === 'string') : undefined;
  const r: EstadoRemoto = { ecf, estado: mapearEstado(status), mensajes: extraerMensajes(dgii) };
  const securityCode = texto(d.securityCode);
  const qrUrl = texto(d.qr_url);
  const internalTrackId = texto(d.internalTrackId);
  const signedDate = texto(d.signedDate);
  if (securityCode) r.securityCode = securityCode;
  if (qrUrl) r.qrUrl = qrUrl;
  if (internalTrackId) r.internalTrackId = internalTrackId;
  if (signedDate) r.signedDate = signedDate;
  return r;
}

// ---------------------------------------------------------------------------
// Envío y consultas
// ---------------------------------------------------------------------------

/** Envía el JSON del e-CF. La respuesta trae lo que hace falta para imprimir (código y QR). */
export async function enviar(
  a: Ambiente,
  s: Sesion,
  apiKey: string,
  json: unknown,
  f: typeof fetch,
): Promise<RespuestaEnvio> {
  const o = objeto(await llamarApi(f, 'POST', `${MSELLER_BASE}/${a}/documentos-ecf`, s, apiKey, json));
  if (!o) throw sinObjeto('el envío');
  // Un 2xx significa que MSeller recibió el documento: si falta algún campo no se
  // lanza (reenviar duplicaría el comprobante); la consulta lo completa después.
  return {
    ecf: texto(o.ecf),
    internalTrackId: texto(o.internalTrackId),
    securityCode: texto(o.securityCode),
    qrUrl: texto(o.qr_url),
    signedDate: texto(o.signedDate),
  };
}

/** Estado de un e-CF. `null` si MSeller no lo conoce (404 o "No encontrado"). */
export async function consultar(
  a: Ambiente,
  s: Sesion,
  apiKey: string,
  encf: string,
  f: typeof fetch,
): Promise<EstadoRemoto | null> {
  let j: unknown;
  try {
    j = await llamarApi(f, 'GET', `${MSELLER_BASE}/${a}/documentos-ecf?ecf=${encodeURIComponent(encf)}`, s, apiKey);
  } catch (e) {
    if (e instanceof MsellerError && e.tipo === 'no_encontrado') return null;
    throw e;
  }
  const o = objeto(j);
  if (!o) throw sinObjeto('la consulta');
  const status = texto(o.status);
  if (status === 'No encontrado') return null;
  return estadoDesde(encf, status, o);
}

/** Estado de hasta 100 e-CF en una sola llamada. */
export async function consultarLote(
  a: Ambiente,
  s: Sesion,
  apiKey: string,
  encfs: string[],
  f: typeof fetch,
): Promise<EstadoRemoto[]> {
  if (encfs.length > MAX_LOTE) {
    throw new RangeError(`MSeller admite hasta ${MAX_LOTE} e-CF por consulta en lote (llegaron ${encfs.length})`);
  }
  if (encfs.length === 0) return [];

  const j = await llamarApi(f, 'POST', `${MSELLER_BASE}/${a}/documentos-ecf/status/batch`, s, apiKey, { ecfs: encfs });
  const o = objeto(j);
  if (!o || !Array.isArray(o.results)) throw sinObjeto('la consulta en lote');

  const salida: EstadoRemoto[] = [];
  for (const item of o.results) {
    const r = objeto(item);
    const ecf = r ? texto(r.ecf) : '';
    if (!r || !ecf) continue;
    if (r.found === false) {
      salida.push({ ecf, estado: 'no_encontrado', mensajes: [] });
      continue;
    }
    const data = objeto(r.data) ?? {};
    salida.push(estadoDesde(ecf, texto(r.status) || texto(data.status), data));
  }
  return salida;
}
