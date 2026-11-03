// Seguimiento del estado de los e-CF ante la DGII (orquestador puro: todo lo que
// toca el mundo entra por `DepsEstado`, así las pruebas lo reemplazan por
// dependencias falsas en memoria y nunca se llama a MSeller ni a la base).
//
// Lo comparten la Edge Function `ecf-estado` (Deno) y las pruebas de `npm test`
// (Node), que lo cargan quitando los tipos: por eso solo usa sintaxis borrable
// (nada de enum, namespace ni parameter properties), sin APIs de Node ni de Deno
// y con imports `.ts`.
//
// Qué hace: los documentos `recibido` (MSeller los tiene, la DGII aún no
// respondió) se consultan en lote, una llamada por empresa y ambiente, y cada
// uno se actualiza según lo que diga MSeller. La base decide qué toca consultar
// (`ecf_consultas_pendientes`, que respeta el tiempo entre consultas del plan).
//
// Reglas:
//   * Una llamada en lote por empresa y ambiente: gasta 1 request.
//   * Todo e-NCF consultado recibe `ultima_consulta_at`, tenga o no novedades;
//     si no, la base lo volvería a pedir en cada pasada.
//   * El `estado` solo se toca si cambió, y entonces también `estado_at` y los
//     mensajes de la DGII. "Sigue en proceso" solo marca la consulta.
//   * Lo que MSeller no conoce o no devuelve no cambia nada (queda un aviso).
//   * Un 429 avisa a SellAlleS y sigue con la otra empresa; cualquier otro fallo
//     de una empresa se registra y tampoco frena a las demás.
//   * Los secretos no se escriben en ningún registro.

import { nuevaConexion, textoDeMensajes } from './emitir.ts';
import type { Conexion } from './emitir.ts';
import { consultarLote, MsellerError } from './mseller.ts';
import type { Ambiente, Credenciales, EstadoRemoto, Sesion } from './mseller.ts';

/** Lo que se le cambia a un documento en una consulta. */
export interface CambioConsulta {
  /** Solo si cambió. */
  estado?: string;
  mensajes_dgii?: unknown;
  /** Va siempre que cambia `estado`. */
  estado_at?: string;
  /** Texto de la falla, igual que lo deja la emisión cuando ve un rechazo. */
  ultimo_error?: string | null;
  /** Lo que MSeller devuelve y al documento le faltaba (solo si estaba sin QR). */
  security_code?: string;
  qr_url?: string;
  signed_at?: string;
  internal_track_id?: string;
  ultima_consulta_at: string;
}

export interface GrupoPendiente {
  companyId: string;
  ambiente: Ambiente;
  encfs: string[];
  /**
   * Cuáles de esos e-NCF siguen sin QR (MSeller contestó el envío con un 2xx
   * incompleto). Solo a esos se les guardan el código, el QR y la fecha de firma
   * que traiga el lote. Sin este dato no se guarda ninguno.
   */
  sinQr?: string[];
}

export interface DepsEstado {
  pendientes(): Promise<GrupoPendiente[]>;
  leerCredenciales(companyId: string, a: Ambiente): Promise<Credenciales>;
  guardarSesion(companyId: string, a: Ambiente, s: Sesion): Promise<void>;
  /**
   * Aplica el cambio al documento. Quien lo implementa solo debe tocar un
   * documento que siga `recibido`: el estado de otro lo cambió alguien más.
   */
  actualizar(companyId: string, encf: string, cambio: CambioConsulta): Promise<void>;
  sumarUso(companyId: string, requests: number, comprobantes: number): Promise<void>;
  avisarSinCupo(companyId: string): Promise<void>;
  fetch: typeof fetch;
  ahora(): Date;
}

// MSeller admite hasta 100 e-CF por consulta en lote. La base ya entrega a lo
// sumo 100; el tope evita que un grupo más grande falle siempre.
const MAX_LOTE = 100;
const MAX_ERROR = 300;

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** El cambio de un documento que MSeller devolvió con un estado distinto de `recibido`. */
function cambioDeEstado(remoto: EstadoRemoto, ahora: string): CambioConsulta {
  const cambio: CambioConsulta = {
    estado: remoto.estado,
    mensajes_dgii: remoto.mensajes,
    estado_at: ahora,
    ultima_consulta_at: ahora,
  };
  // Igual que la emisión: un rechazo o un error deja el texto de la falla.
  if (remoto.estado === 'rechazado') {
    cambio.ultimo_error = textoDeMensajes(remoto.mensajes, 'La DGII rechazó el comprobante.');
  } else if (remoto.estado === 'error_datos') {
    cambio.ultimo_error = textoDeMensajes(
      remoto.mensajes,
      'MSeller respondió con un error o con un estado que no se reconoce.',
    );
  }
  return cambio;
}

/**
 * Consulta el estado de los documentos `recibido` que toca revisar y guarda lo
 * que MSeller informe. No lanza por fallos de MSeller, de red ni de una
 * empresa: los registra y sigue con la siguiente. Solo lanza si no puede leer
 * qué hay pendiente.
 *
 * Devuelve cuántas empresas se consultaron (MSeller respondió) y cuántos
 * documentos cambiaron de estado.
 */
export async function consultarPendientes(deps: DepsEstado): Promise<{ empresas: number; cambios: number }> {
  const grupos = await deps.pendientes();
  const consultadas = new Set<string>();
  let cambios = 0;

  for (const g of grupos) {
    const encfs = g.encfs.slice(0, MAX_LOTE);
    if (encfs.length === 0) continue;

    let conexion: Conexion | undefined;
    try {
      const c = nuevaConexion(await deps.leerCredenciales(g.companyId, g.ambiente), g, deps);
      conexion = c;

      const remotos = await c.llamar((s) => consultarLote(g.ambiente, s, c.apiKey, encfs, deps.fetch));
      consultadas.add(g.companyId);
      cambios += await guardarResultados(g, encfs, remotos, deps);
    } catch (e) {
      if (e instanceof MsellerError && e.tipo === 'cupo') {
        // MSeller dejó de atender por falta de cupo: no es un error del
        // documento. Se avisa (una vez por mes) y se sigue con la otra empresa.
        try {
          await deps.avisarSinCupo(g.companyId);
        } catch (a) {
          console.error('ecf-estado: no se pudo avisar de la falta de cupo de', g.companyId, mensajeDe(a).slice(0, MAX_ERROR));
        }
      } else {
        const crudo = mensajeDe(e);
        const mensaje = conexion ? conexion.ocultar(crudo) : crudo;
        console.error('ecf-estado: falló la consulta de', g.companyId, g.ambiente, mensaje.slice(0, MAX_ERROR));
      }
    } finally {
      // Contar es contabilidad: si falla no deshace lo que ya se hizo.
      const requests = conexion ? conexion.requests() : 0;
      if (requests > 0) {
        try {
          await deps.sumarUso(g.companyId, requests, 0);
        } catch {
          // se ignora a propósito
        }
      }
    }
  }

  return { empresas: consultadas.size, cambios };
}

/** Guarda lo que MSeller contestó para cada e-NCF pedido. Devuelve cuántos cambiaron de estado. */
async function guardarResultados(
  g: GrupoPendiente,
  pedidos: string[],
  remotos: EstadoRemoto[],
  deps: DepsEstado,
): Promise<number> {
  const ahora = deps.ahora().toISOString();
  const porEncf = new Map(remotos.map((r) => [r.ecf, r]));
  const sinQr = new Set(g.sinQr ?? []);
  let cambios = 0;

  for (const encf of pedidos) {
    const remoto = porEncf.get(encf);

    let cambio: CambioConsulta;
    if (!remoto || remoto.estado === 'no_encontrado') {
      // MSeller no devolvió este e-NCF o dice no conocerlo, pero lo tenemos
      // recibido: no se inventa un estado. Solo se anota que se consultó.
      console.warn('ecf-estado: MSeller no devolvió el estado de', encf);
      cambio = { ultima_consulta_at: ahora };
    } else if (remoto.estado === 'recibido') {
      cambio = { ultima_consulta_at: ahora };
    } else {
      cambio = cambioDeEstado(remoto, ahora);
    }

    // Si el envío no dejó el QR, esta consulta puede completarlo.
    if (remoto && sinQr.has(encf) && (remoto.securityCode || remoto.qrUrl || remoto.signedDate)) {
      if (remoto.securityCode) cambio.security_code = remoto.securityCode;
      if (remoto.qrUrl) cambio.qr_url = remoto.qrUrl;
      if (remoto.signedDate) cambio.signed_at = remoto.signedDate;
      if (remoto.internalTrackId) cambio.internal_track_id = remoto.internalTrackId;
    }

    try {
      await deps.actualizar(g.companyId, encf, cambio);
      if (cambio.estado !== undefined) cambios++;
    } catch (e) {
      // Un documento que no se pudo guardar no frena a los demás: sigue
      // `recibido` y se consulta en la próxima pasada.
      console.error('ecf-estado: no se pudo guardar', encf, mensajeDe(e).slice(0, MAX_ERROR));
    }
  }
  return cambios;
}
