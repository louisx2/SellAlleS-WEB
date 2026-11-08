// Emisión de un e-CF a MSeller (orquestador puro: todo lo que toca el mundo
// entra por `DepsEmision`, así las pruebas lo reemplazan por dependencias falsas
// en memoria y nunca se llama a MSeller ni a la base de datos).
//
// Lo comparten la Edge Function `ecf-emitir` (Deno) y las pruebas de `npm test`
// (Node), que lo cargan quitando los tipos: por eso solo usa sintaxis borrable
// (nada de enum, namespace ni parameter properties), sin APIs de Node ni de Deno
// y con imports `.ts`.
//
// Reglas que sostienen todo el archivo:
//   * Un 2xx de MSeller significa que recibió el documento: NUNCA se reenvía lo
//     que ya respondió. Si la respuesta vino incompleta se registra `recibido` y
//     la consulta lo completa después.
//   * Si un intento anterior pudo llegar a MSeller sin que viéramos la respuesta
//     (timeout, 5xx, el proceso murió), el siguiente consulta antes de enviar.
//     `ecf_reservar_documento` cuenta cada reserva, así que `intentos > 1` es
//     justo esa señal.
//   * La consulta previa va antes de armar el comprobante: si MSeller ya lo
//     tiene, vale lo suyo aunque los datos hayan cambiado después.
//   * Cada registro va condicionado a la reserva (`intentos`): si otro worker
//     la tomó, no se pisa lo que él guarde.
//   * Los secretos (contraseña, API key, tokens) no se devuelven, no se escriben
//     en `ultimo_error` ni en `request_json`.

import { armarEcf } from './armar.ts';
import type { DatosEcf } from './armar.ts';
import { consultar, enviar, MsellerError, proximoIntento, sesionVigente } from './mseller.ts';
import type { Ambiente, Credenciales, EstadoRemoto, Sesion, TipoFallo } from './mseller.ts';

export interface DocReservado {
  id: string;
  companyId: string;
  encf: string;
  ambiente: Ambiente;
  intentos: number;
}

export interface CambioDocumento {
  /**
   * El estado nuevo. Se omite cuando el cambio no lo toca (completar el QR): el
   * seguimiento de estados lo cambia en paralelo y no hay que pisarlo.
   */
  estado?: string;
  security_code?: string;
  qr_url?: string;
  signed_at?: string;
  internal_track_id?: string;
  request_json?: unknown;
  ultimo_error?: string | null;
  proximo_intento_at?: string;
  enviado_at?: string;
  estado_at?: string;
  mensajes_dgii?: unknown;
  reservado_hasta?: null;
}

export interface DepsEmision {
  reservar(id: string): Promise<DocReservado | null>;
  cargarDatos(doc: DocReservado): Promise<DatosEcf>;
  leerCredenciales(companyId: string, a: Ambiente): Promise<Credenciales>;
  guardarSesion(companyId: string, a: Ambiente, s: Sesion): Promise<void>;
  /**
   * Guarda el cambio. Con `intentos`, solo si el documento sigue con ese número
   * de intentos (la reserva es de quien lo llama) y devuelve false si no tocó
   * ninguna fila: otro worker tomó la reserva. Sin `intentos` lo guarda siempre.
   */
  registrar(id: string, cambio: CambioDocumento, intentos?: number): Promise<boolean>;
  sumarUso(companyId: string, requests: number, comprobantes: number): Promise<void>;
  fetch: typeof fetch;
  ahora(): Date;
}

export interface ResultadoEmision {
  /** El estado en que quedó; 'ocupado' si no se pudo reservar, 'reserva_perdida' si otro la tomó a mitad. */
  estado: string;
  encf?: string;
  qrUrl?: string;
  securityCode?: string;
  signedAt?: string;
  error?: string;
  /** Qué falló al hablar con MSeller (solo si quedó por_enviar por eso): lo usa el lote para cortar. */
  fallo?: { tipo: TipoFallo; enLogin: boolean };
}

/**
 * Un dato del comprobante que falta o está mal y que reintentar no arregla (la
 * venta ya no existe, la empresa no tiene configuración de e-CF...). `cargarDatos`
 * la lanza y el documento queda en `error_datos`. Cualquier otro error al cargar
 * (la base no contestó) se reintenta.
 */
export class ErrorDatosEcf extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDatosEcf';
  }
}

const MAX_ERROR = 500;
const MIN_SECRETO = 4;

/** Quita las claves vacías (`undefined` y '') para que la fila conserve null en esos campos. */
function sinVacios<T extends object>(o: T): T {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== '') r[k] = v;
  }
  return r as T;
}

// ---------------------------------------------------------------------------
// Conexión con MSeller: sesión, 401 y cuenta de requests
// ---------------------------------------------------------------------------

export type DepsConexion = Pick<DepsEmision, 'guardarSesion' | 'fetch' | 'ahora'>;

export interface Conexion {
  apiKey: string;
  /** Los secretos conocidos hasta ahora (crece al abrir sesión). */
  secretos: Array<string | null>;
  /** Hace la llamada con la sesión vigente; ante un 401 inicia sesión de nuevo y reintenta una vez. */
  llamar<T>(f: (s: Sesion) => Promise<T>): Promise<T>;
  /** Llamadas que MSeller atendió y gastan cupo (una respuesta de autenticación no cuenta). */
  requests(): number;
  ocultar(texto: string): string;
}

/**
 * Un fallo al iniciar sesión (no al usar la sesión). Sigue siendo un
 * MsellerError: lo que mira `tipo` lo trata igual; el lote además sabe que fue
 * MSeller rechazando la cuenta y no un documento.
 */
export class FalloDeLogin extends MsellerError {
  constructor(tipo: TipoFallo, mensaje: string, status?: number) {
    super(tipo, mensaje, status);
  }
}

/** Un fallo al iniciar sesión es del acceso, no del comprobante: nunca `datos` ni `cupo`. */
function comoFalloDeAcceso(e: unknown): unknown {
  if (!(e instanceof MsellerError)) return e;
  const tipo: TipoFallo = e.tipo === 'datos' || e.tipo === 'cupo' || e.tipo === 'no_encontrado' ? 'auth' : e.tipo;
  return new FalloDeLogin(tipo, e.message, e.status);
}

/** También la usa el seguimiento de estados (estado.ts): la misma sesión, el mismo conteo de requests. */
export function nuevaConexion(
  cred: Credenciales,
  doc: { companyId: string; ambiente: Ambiente },
  deps: DepsConexion,
): Conexion {
  const secretos: Array<string | null> = [cred.password, cred.apiKey, cred.refreshToken, cred.idToken];
  let requests = 0;
  let sesion: Sesion | null = null;

  const abrir = async (c: Credenciales): Promise<Sesion> => {
    let abierta: { sesion: Sesion; nueva: boolean };
    try {
      abierta = await sesionVigente(c, doc.ambiente, deps.fetch, deps.ahora());
    } catch (e) {
      throw comoFalloDeAcceso(e);
    }
    // Antes de guardarla: si guardar falla, el mensaje no puede dejar salir los tokens nuevos.
    secretos.push(abierta.sesion.idToken, abierta.sesion.refreshToken);
    if (abierta.nueva) await deps.guardarSesion(doc.companyId, doc.ambiente, abierta.sesion);
    return abierta.sesion;
  };

  const intento = async <T>(f: (s: Sesion) => Promise<T>, s: Sesion): Promise<T> => {
    try {
      const r = await f(s);
      requests++;
      return r;
    } catch (e) {
      // Sin respuesta HTTP (red), con una de autenticación o con un 429 (MSeller
      // no atendió la llamada por falta de cupo) no se gasta cupo.
      if (e instanceof MsellerError && e.tipo !== 'red' && e.tipo !== 'auth' && e.tipo !== 'cupo') requests++;
      throw e;
    }
  };

  return {
    apiKey: cred.apiKey,
    secretos,
    requests: () => requests,
    ocultar: (texto) => {
      let r = texto;
      for (const s of secretos) {
        if (s && s.length >= MIN_SECRETO) r = r.split(s).join('***');
      }
      return r;
    },
    llamar: async <T>(f: (s: Sesion) => Promise<T>): Promise<T> => {
      if (!sesion) sesion = await abrir(cred);
      try {
        return await intento(f, sesion);
      } catch (e) {
        if (!(e instanceof MsellerError && e.tipo === 'auth')) throw e;
        // Sin idToken, sin vencimiento y sin refreshToken no queda nada que
        // reutilizar ni renovar: sesionVigente inicia sesión con la contraseña.
        sesion = await abrir({ ...cred, idToken: null, idTokenVence: null, refreshToken: null });
        return await intento(f, sesion);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

/** Texto de los mensajes de la DGII, o el de respaldo si no hay. */
export function textoDeMensajes(mensajes: EstadoRemoto['mensajes'], respaldo: string): string {
  const texto = mensajes.map((m) => m.valor).join('; ');
  return (texto || respaldo).slice(0, MAX_ERROR);
}

/**
 * Manda a MSeller el documento `id` (que está en `por_enviar` o con una reserva
 * vencida) y deja registrado lo que pasó. No lanza por fallos de MSeller, de red
 * ni de datos: los registra y los devuelve en el resultado. Solo lanza si no
 * puede guardar lo que MSeller ya recibió (queda `enviando`, y el siguiente
 * intento consulta antes de enviar, así que no se duplica).
 *
 * Si al registrar resulta que otro worker tomó la reserva (la reserva venció y
 * el documento ya tiene más intentos), no escribe nada más y devuelve
 * 'reserva_perdida': lo que pase con el documento lo registra ese otro.
 */
export async function emitirDocumento(id: string, deps: DepsEmision): Promise<ResultadoEmision> {
  const doc = await deps.reservar(id);
  if (!doc) return { estado: 'ocupado' };

  let conexion: Conexion | undefined;
  let jsonEnviado: unknown;
  let comprobantes = 0;
  // Verdadero en cuanto MSeller dio señales de tener el documento.
  let yaRespondio = false;

  const conectar = async (): Promise<Conexion> => {
    if (!conexion) conexion = nuevaConexion(await deps.leerCredenciales(doc.companyId, doc.ambiente), doc, deps);
    return conexion;
  };

  // Toda salida de `enviando` pone la fecha del cambio y suelta la reserva, si
  // la reserva sigue siendo de este intento.
  const cerrar = async (cambio: CambioDocumento, resultado: ResultadoEmision): Promise<ResultadoEmision> => {
    const cuando = deps.ahora().toISOString();
    const aplicado = await deps.registrar(
      doc.id,
      sinVacios({ ...cambio, estado_at: cuando, reservado_hasta: null }),
      doc.intentos,
    );
    if (aplicado === false) return { estado: 'reserva_perdida', encf: doc.encf };
    return sinVacios({ ...resultado, encf: doc.encf });
  };

  // Lo recibió MSeller y quedó registrado: se cuenta el comprobante. Si la
  // reserva se perdió no: el otro worker consulta antes de enviar y lo cuenta él.
  const contar = (r: ResultadoEmision): ResultadoEmision => {
    comprobantes = r.estado === 'reserva_perdida' ? 0 : 1;
    return r;
  };

  const fallar = (e: unknown): Promise<ResultadoEmision> => {
    const crudo = e instanceof Error ? e.message : String(e);
    const mensaje = (conexion ? conexion.ocultar(crudo) : crudo).slice(0, MAX_ERROR);

    if (e instanceof MsellerError && e.tipo === 'cupo') {
      return cerrar({ estado: 'sin_cupo', ultimo_error: mensaje }, { estado: 'sin_cupo', error: mensaje });
    }
    if (e instanceof ErrorDatosEcf || (e instanceof MsellerError && e.tipo === 'datos')) {
      return cerrar(
        // Para soporte: lo que MSeller no aceptó (si el rechazo fue al enviar).
        { estado: 'error_datos', ultimo_error: mensaje, request_json: jsonEnviado },
        { estado: 'error_datos', error: mensaje },
      );
    }
    // Red, servidor, autenticación que no se arregló, o un error nuestro: se
    // vuelve a intentar con espera escalonada.
    return cerrar(
      {
        estado: 'por_enviar',
        proximo_intento_at: proximoIntento(doc.intentos, deps.ahora()).toISOString(),
        ultimo_error: mensaje,
      },
      {
        estado: 'por_enviar',
        error: mensaje,
        fallo: e instanceof MsellerError ? { tipo: e.tipo, enLogin: e instanceof FalloDeLogin } : undefined,
      },
    );
  };

  try {
    // Un intento anterior pudo llegar a MSeller sin que viéramos la respuesta.
    // Si ya lo tiene se guarda lo suyo (antes de armar: lo que MSeller tiene
    // vale aunque los datos hayan cambiado después); solo si no lo conoce se
    // arma y se envía.
    if (doc.intentos > 1) {
      const c = await conectar();
      const remoto = await c.llamar((s) => consultar(doc.ambiente, s, c.apiKey, doc.encf, deps.fetch));
      if (remoto && remoto.estado !== 'no_encontrado') {
        yaRespondio = true;
        const falla =
          remoto.estado === 'rechazado'
            ? textoDeMensajes(remoto.mensajes, 'La DGII rechazó el comprobante.')
            : remoto.estado === 'error_datos'
              ? textoDeMensajes(remoto.mensajes, 'MSeller respondió con un error o con un estado que no se reconoce.')
              : null;
        const resultado = await cerrar(
          {
            estado: remoto.estado,
            security_code: remoto.securityCode,
            qr_url: remoto.qrUrl,
            signed_at: remoto.signedDate,
            internal_track_id: remoto.internalTrackId,
            mensajes_dgii: remoto.mensajes,
            ultimo_error: falla,
            // No sabemos cuándo llegó de verdad; esta es la hora en que se confirma.
            enviado_at: deps.ahora().toISOString(),
          },
          {
            estado: remoto.estado,
            qrUrl: remoto.qrUrl,
            securityCode: remoto.securityCode,
            signedAt: remoto.signedDate,
            error: falla ?? undefined,
          },
        );
        // Nadie lo había contado: el envío anterior no vio respuesta.
        return contar(resultado);
      }
    }

    const armado = armarEcf(await deps.cargarDatos(doc));
    if (!armado.ok) {
      return await cerrar(
        { estado: 'error_datos', ultimo_error: armado.error },
        { estado: 'error_datos', error: armado.error },
      );
    }

    const c = await conectar();
    jsonEnviado = armado.json;
    const resp = await c.llamar((s) => enviar(doc.ambiente, s, c.apiKey, armado.json, deps.fetch));
    yaRespondio = true;

    // Si MSeller contestó 2xx sin código o sin QR, esos campos quedan vacíos y
    // la consulta los llena después: reenviar duplicaría el comprobante.
    const resultado = await cerrar(
      {
        estado: 'recibido',
        security_code: resp.securityCode,
        qr_url: resp.qrUrl,
        signed_at: resp.signedDate,
        internal_track_id: resp.internalTrackId,
        request_json: armado.json,
        ultimo_error: null,
        enviado_at: deps.ahora().toISOString(),
      },
      { estado: 'recibido', qrUrl: resp.qrUrl, securityCode: resp.securityCode, signedAt: resp.signedDate },
    );
    return contar(resultado);
  } catch (e) {
    // MSeller ya tiene el documento y no pudimos guardarlo: no se pisa el estado
    // con otro intento; el próximo (con la reserva vencida) consulta primero.
    if (yaRespondio) throw e;
    return await fallar(e);
  } finally {
    // Contar es contabilidad: si falla no deshace lo que ya se hizo.
    const requests = conexion ? conexion.requests() : 0;
    if (requests > 0 || comprobantes > 0) {
      try {
        await deps.sumarUso(doc.companyId, requests, comprobantes);
      } catch {
        // se ignora a propósito
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lote del cron: cortar por empresa cuando MSeller no la atiende
// ---------------------------------------------------------------------------

/**
 * ¿Este fallo dice que los demás documentos de la empresa en ese ambiente
 * fallarían igual? MSeller no aceptó el acceso (`auth`, al iniciar sesión o
 * con la sesión recién abierta) o respondió con un error suyo (`servidor`, 5xx).
 */
export function cortaElLote(r: ResultadoEmision): boolean {
  return r.fallo?.tipo === 'auth' || r.fallo?.tipo === 'servidor';
}

/** MSeller rechazó el inicio de sesión: la cuenta de la empresa no sirve hasta que se corrija. */
export function credencialesRechazadas(r: ResultadoEmision): boolean {
  return r.fallo?.tipo === 'auth' && r.fallo.enLogin;
}

export interface DocLote {
  id: string;
  companyId: string;
  ambiente: Ambiente;
}

export interface DepsLote {
  emitir(id: string): Promise<ResultadoEmision>;
  /** Pospone 30 minutos lo que espera de esa empresa y ambiente (ecf_posponer_por_credenciales). */
  posponerPorCredenciales(companyId: string, ambiente: Ambiente): Promise<void>;
  /** Una línea para el registro de la función (ya sin secretos). */
  registrarError(texto: string): void;
}

export interface ResultadoLote {
  /** Los que se reservaron y terminaron (ni ocupados ni con la reserva perdida). */
  procesados: number;
  /** Los que no se intentaron porque su empresa ya falló en esta vuelta. */
  saltados: number;
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Emite los documentos del lote, a lo sumo `enParalelo` a la vez. En cuanto uno
 * de una empresa falla por acceso o por un error de MSeller, los que faltan de
 * esa empresa y ambiente ni se reservan en esta vuelta (se quedan como están y
 * el cron los vuelve a pedir). Si MSeller rechazó el inicio de sesión, además
 * se pospone lo que espera de esa empresa: insistir con la misma contraseña
 * puede bloquear la cuenta. Un documento que lanza no frena a los demás.
 */
export async function emitirLote(docs: DocLote[], enParalelo: number, deps: DepsLote): Promise<ResultadoLote> {
  const cortadas = new Set<string>();
  const clave = (d: DocLote) => `${d.companyId}|${d.ambiente}`;
  let procesados = 0;
  let saltados = 0;
  let siguiente = 0;

  const trabajador = async () => {
    while (siguiente < docs.length) {
      const d = docs[siguiente++];
      if (cortadas.has(clave(d))) {
        saltados++;
        continue;
      }
      let r: ResultadoEmision;
      try {
        r = await deps.emitir(d.id);
      } catch (e) {
        // No se pudo guardar el resultado: queda `enviando` y el cron lo
        // retoma cuando venza su reserva.
        deps.registrarError(`ecf-emitir: falló un documento del lote: ${d.id} ${mensajeDe(e)}`);
        continue;
      }
      if (r.estado !== 'ocupado' && r.estado !== 'reserva_perdida') procesados++;
      if (cortaElLote(r)) cortadas.add(clave(d));
      // Cada vez (no solo la primera): un documento que ya estaba en camino
      // cuando se cortó también vuelve con su espera corta y hay que posponerlo.
      if (credencialesRechazadas(r)) {
        try {
          await deps.posponerPorCredenciales(d.companyId, d.ambiente);
        } catch (e) {
          deps.registrarError(`ecf-emitir: no se pudo posponer lo de la empresa ${d.companyId}: ${mensajeDe(e)}`);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(0, Math.min(enParalelo, docs.length)) }, trabajador));
  return { procesados, saltados };
}

/**
 * El punto de venta manda una sola venta o nota. Si MSeller rechazó el inicio
 * de sesión, igual que en el lote se pospone lo que espera de la empresa, y la
 * base marca la cuenta: los documentos que nazcan en los próximos 30 minutos ya
 * salen pospuestos, así que vender no vuelve a probar la contraseña con cada
 * venta (insistir puede bloquear la cuenta). A diferencia del lote, un error al
 * guardar el resultado sube: el punto de venta responde 500 y el cron lo retoma.
 */
export async function emitirUno(d: DocLote, deps: DepsLote): Promise<ResultadoEmision> {
  const r = await deps.emitir(d.id);
  if (credencialesRechazadas(r)) {
    try {
      await deps.posponerPorCredenciales(d.companyId, d.ambiente);
    } catch (e) {
      deps.registrarError(`ecf-emitir: no se pudo posponer lo de la empresa ${d.companyId}: ${mensajeDe(e)}`);
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Completar un documento ya recibido
// ---------------------------------------------------------------------------

export interface DocCompletable {
  id: string;
  companyId: string;
  encf: string;
  ambiente: Ambiente;
}

export type DepsCompletar = Pick<
  DepsEmision,
  'leerCredenciales' | 'guardarSesion' | 'registrar' | 'sumarUso' | 'fetch' | 'ahora'
>;

/**
 * Un documento `recibido` o aceptado al que le faltó el QR (MSeller contestó el
 * envío con un 2xx incompleto): consulta una vez y, si MSeller ya tiene el
 * código, el QR o la fecha de firma, los guarda. Nunca reenvía y es de mejor
 * esfuerzo: si algo falla devuelve false y el documento queda como estaba.
 *
 * Nunca escribe el `estado`: el seguimiento de estados (ecf-estado) lo puede
 * cambiar mientras esta consulta está en el aire, y devolver el que se leyó
 * antes pisaría un `aceptado` o un `rechazado` recién guardado.
 */
export async function completarDocumento(doc: DocCompletable, deps: DepsCompletar): Promise<boolean> {
  let conexion: Conexion | undefined;
  try {
    const c = nuevaConexion(await deps.leerCredenciales(doc.companyId, doc.ambiente), doc, deps);
    conexion = c;

    const remoto = await c.llamar((s) => consultar(doc.ambiente, s, c.apiKey, doc.encf, deps.fetch));
    if (!remoto || !(remoto.securityCode || remoto.qrUrl || remoto.signedDate)) return false;

    await deps.registrar(
      doc.id,
      sinVacios({
        security_code: remoto.securityCode,
        qr_url: remoto.qrUrl,
        signed_at: remoto.signedDate,
        internal_track_id: remoto.internalTrackId,
      }),
    );
    return true;
  } catch {
    return false;
  } finally {
    const requests = conexion ? conexion.requests() : 0;
    if (requests > 0) {
      try {
        await deps.sumarUso(doc.companyId, requests, 0);
      } catch {
        // se ignora a propósito
      }
    }
  }
}
