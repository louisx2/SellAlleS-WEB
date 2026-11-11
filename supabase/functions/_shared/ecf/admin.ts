// Lo que hace `ecf-admin` una vez que sabe que quien llama es el super admin:
// validar el pedido, guardar las credenciales de MSeller de una empresa y
// ambiente, y probar la conexión con un login nuevo.
//
// Módulo puro: el cliente de Supabase (con la service role), `fetch` y la hora
// entran como parámetros y solo importa tipos de Supabase, así las pruebas de
// `npm test` (Node, que carga los .ts quitando los tipos) lo ejercitan con un
// cliente y un `fetch` falsos. Por eso solo usa sintaxis borrable (nada de enum,
// namespace ni parameter properties). La autorización (la sesión y
// `profiles.is_super_admin`) y `Deno.serve` se quedan en `ecf-admin/index.ts`.
//
// Aquí está lo que maneja credenciales en claro y manda texto de vuelta al
// navegador: ninguna respuesta, mensaje de error ni línea de registro lleva la
// contraseña, la API key ni los tokens (lo que diga MSeller o la base se limpia
// antes de salir).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { consultar, MsellerError, sesionVigente } from './mseller.ts';
import type { Ambiente, Sesion } from './mseller.ts';
import { guardarSesion, leerCredenciales, sumarUso } from './rpc.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMBIENTES: Ambiente[] = ['TesteCF', 'CerteCF', 'eCF'];
// Igual que en mseller.ts y emitir.ts: un secreto más corto no se puede buscar sin estropear el texto.
const MIN_SECRETO = 4;

/** Lo que dice la respuesta cuando algo falló por dentro (la base o la red del propio panel). */
export const ERROR_INTERNO = 'No se pudo completar la operación. Intenta de nuevo.';

export interface DepsAdmin {
  fetch: typeof fetch;
  ahora(): Date;
  /** Una línea para el registro de la función. Ya viene sin secretos. */
  registrar(texto: string): void;
}

/** La respuesta HTTP que `ecf-admin` devuelve al panel. */
export interface RespuestaAdmin {
  status: number;
  cuerpo: { ok: true; marcada?: boolean } | { ok: false; error: string };
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

const fallo = (status: number, error: string): RespuestaAdmin => ({ status, cuerpo: { ok: false, error } });

/** Cambia cada secreto que aparezca en `texto` por `***`. */
export function ocultar(texto: string, secretos: Array<string | null | undefined>): string {
  let r = texto;
  for (const s of secretos) {
    if (s && s.length >= MIN_SECRETO) r = r.split(s).join('***');
  }
  return r;
}

/** El motivo, en español, por el que no se pudo iniciar sesión. */
export function motivoDe(e: unknown): string {
  if (e instanceof MsellerError) {
    // En un 400 o 422 el mensaje es el cuerpo que mandó MSeller, a menudo en
    // inglés y sin contexto: se aclara de qué se trata. Los demás ya dicen
    // "MSeller ..." en español.
    return e.tipo === 'datos' ? `MSeller no aceptó el inicio de sesión: ${e.message}` : e.message;
  }
  return mensajeDe(e);
}

/**
 * Un e-NCF con formato válido que nadie emite. Consultarlo prueba la API key
 * sin tocar ningún comprobante: el inicio de sesión no la lleva, así que sin
 * esta consulta una key equivocada no se notaría hasta el primer envío.
 */
export const ENCF_DE_PRUEBA = 'E329999999999';

/** Cada API key de MSeller sirve para un solo ambiente, y una recién creada tarda en propagarse. */
export function motivoApiKey(ambiente: Ambiente): string {
  return (
    `La cuenta inicia sesión, pero MSeller no aceptó la API key en ${ambiente}. ` +
    'Revisa que sea la key de ese ambiente (cada key sirve para uno solo); ' +
    'si la acabas de crear, espera un minuto y vuelve a probar.'
  );
}

/**
 * Consulta `ENCF_DE_PRUEBA` con la sesión nueva y la API key. Si MSeller
 * atiende la consulta (aunque no conozca el e-NCF u objete el parámetro), la
 * key sirve y se suma esa consulta al uso del plan. Lanza si MSeller rechaza la
 * key, no tiene cupo, está caído o no responde.
 */
async function probarApiKey(
  db: SupabaseClient,
  companyId: string,
  ambiente: Ambiente,
  sesion: Sesion,
  apiKey: string,
  deps: DepsAdmin,
): Promise<void> {
  let fallo: unknown = null;
  let atendida = true;
  try {
    await consultar(ambiente, sesion, apiKey, ENCF_DE_PRUEBA, deps.fetch);
  } catch (e) {
    if (!(e instanceof MsellerError)) throw e;
    // Igual que en emitir.ts: sin respuesta, con un rechazo de acceso o con un
    // 429 MSeller no atendió la llamada y no gasta cupo.
    atendida = e.tipo !== 'red' && e.tipo !== 'auth' && e.tipo !== 'cupo';
    // Un 400/422 es MSeller objetando el parámetro: ya aceptó la key.
    if (e.tipo === 'auth') fallo = new MsellerError('auth', motivoApiKey(ambiente), e.status);
    else if (e.tipo !== 'datos') fallo = e;
  }
  if (atendida) {
    try {
      await sumarUso(db, companyId, 1, 0);
    } catch {
      // Contabilidad: si falla, la prueba vale igual.
    }
  }
  if (fallo) throw fallo;
}

export type ResultadoPrueba =
  | { ok: true; marcada: boolean }
  | { ok: false; error: string };

/**
 * Inicia sesión en MSeller con las credenciales guardadas y deja la sesión
 * guardada. Un fallo de MSeller (o de la base) no lanza: vuelve como `ok: false`
 * con un motivo sin secretos.
 */
export async function probarConexion(
  db: SupabaseClient,
  companyId: string,
  ambiente: Ambiente,
  deps: DepsAdmin,
): Promise<ResultadoPrueba> {
  const secretos: Array<string | null> = [];
  try {
    const cred = await leerCredenciales(db, companyId, ambiente);
    secretos.push(cred.password, cred.apiKey, cred.refreshToken, cred.idToken);

    // Un login nuevo con la contraseña: sin idToken, vencimiento ni refreshToken
    // no queda sesión que reutilizar ni renovar, y lo que se prueba es la cuenta.
    const { sesion } = await sesionVigente(
      { ...cred, idToken: null, idTokenVence: null, refreshToken: null },
      ambiente,
      deps.fetch,
      deps.ahora(),
    );
    // Antes de guardarla: si guardar falla, el mensaje no puede dejar salir los tokens nuevos.
    secretos.push(sesion.idToken, sesion.refreshToken);
    await guardarSesion(db, companyId, ambiente, sesion);

    // La conexión solo queda probada si además MSeller acepta la API key.
    await probarApiKey(db, companyId, ambiente, sesion, cred.apiKey, deps);

    // La marca vale para el ambiente en uso de la empresa: probar otro (p. ej.
    // CerteCF antes de pasar a eCF) no la pone, porque el disparador de
    // ecf_config la borraría al cambiar de ambiente.
    const { data, error } = await db
      .from('ecf_config')
      .update({ conexion_probada_at: deps.ahora().toISOString() })
      .eq('company_id', companyId)
      .eq('ambiente', ambiente)
      .select('company_id');
    if (error) throw new Error(`No se pudo marcar la conexión como probada: ${error.message}`);
    return { ok: true, marcada: Array.isArray(data) && data.length > 0 };
  } catch (e) {
    // Un fallo de MSeller es un resultado esperado de la prueba; cualquier otro
    // (la base) además queda en el registro, con el mismo texto sin secretos.
    const error = ocultar(motivoDe(e), secretos);
    if (!(e instanceof MsellerError)) deps.registrar(`ecf-admin: probar_conexion: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Valida lo que mandó el panel y guarda las credenciales con
 * `ecf_guardar_credenciales` (que las escribe en Vault). Lanza si la base falla;
 * `administrar` lo convierte en una respuesta sin secretos.
 */
export async function guardarCredenciales(
  db: SupabaseClient,
  companyId: string,
  ambiente: Ambiente,
  pedido: Record<string, unknown>,
): Promise<RespuestaAdmin> {
  const { email, password, apiKey } = pedido;
  if (typeof email !== 'string' || email.trim() === '') {
    return fallo(400, 'Falta el correo de la cuenta de MSeller.');
  }
  if (typeof password !== 'string' || password === '') {
    return fallo(400, 'Falta la contraseña de la cuenta de MSeller.');
  }
  if (typeof apiKey !== 'string' || apiKey === '') {
    return fallo(400, 'Falta la API key de MSeller.');
  }

  const { data: empresa, error: empresaErr } = await db
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (empresaErr) throw new Error(`No se pudo comprobar la empresa: ${empresaErr.message}`);
  if (!empresa) return fallo(404, 'La empresa no existe.');

  const { error } = await db.rpc('ecf_guardar_credenciales', {
    p_company: companyId,
    p_ambiente: ambiente,
    p_email: email,
    p_password: password,
    p_api_key: apiKey,
  });
  if (error) throw new Error(`No se pudieron guardar las credenciales: ${error.message}`);
  return { status: 200, cuerpo: { ok: true } };
}

/**
 * El pedido ya autorizado del panel: `{ accion, companyId, ambiente, ... }`.
 * Nunca lanza: lo que falle por dentro vuelve como un 500 genérico y se registra
 * sin la contraseña ni la API key que haya traído el pedido.
 */
export async function administrar(db: SupabaseClient, body: unknown, deps: DepsAdmin): Promise<RespuestaAdmin> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fallo(400, 'Solicitud inválida.');
  }
  const pedido = body as Record<string, unknown>;
  // Lo que mandó el panel que no se puede dejar salir si algo falla.
  const secretosDelPedido = [pedido.password, pedido.apiKey].filter((x): x is string => typeof x === 'string');

  try {
    const { accion, companyId, ambiente } = pedido;
    if (typeof companyId !== 'string' || !UUID.test(companyId)) {
      return fallo(400, 'La empresa no es válida.');
    }
    if (typeof ambiente !== 'string' || !AMBIENTES.includes(ambiente as Ambiente)) {
      return fallo(400, 'El ambiente debe ser TesteCF, CerteCF o eCF.');
    }
    const amb = ambiente as Ambiente;

    if (accion === 'guardar_credenciales') return await guardarCredenciales(db, companyId, amb, pedido);
    if (accion === 'probar_conexion') return { status: 200, cuerpo: await probarConexion(db, companyId, amb, deps) };
    return fallo(400, 'Acción desconocida. Usa guardar_credenciales o probar_conexion.');
  } catch (e) {
    deps.registrar(`ecf-admin: ${ocultar(mensajeDe(e), secretosDelPedido)}`);
    return fallo(500, ERROR_INTERNO);
  }
}
