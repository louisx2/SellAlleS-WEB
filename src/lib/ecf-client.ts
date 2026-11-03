import type { EcfDocumento } from '@/lib/types';
import type { AmbienteEcf } from '@/lib/ecf';
import { supabase } from '@/lib/supabase/client';
import { rowToEcfDocumento } from '@/lib/supabase/mappers';

/**
 * Pide a la Edge Function `ecf-emitir` que emita el e-CF de una venta o de una
 * nota de crédito, y devuelve el documento como quedó.
 *
 * Nunca lanza ni deja a la caja esperando: ante cualquier error, o si no
 * responde en `timeoutMs`, devuelve null. null no significa que falló: el
 * documento ya está guardado en el servidor y se reintenta solo, así que quien
 * llama muestra el comprobante "por enviar" y sigue.
 */
export async function emitirEcf(
  target: { saleId: string } | { creditNoteId: string },
  timeoutMs = 10000,
): Promise<EcfDocumento | null> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const llamada = supabase.functions
      .invoke('ecf-emitir', { body: target })
      .then(({ data, error }) => (error || !data?.documento ? null : rowToEcfDocumento(data.documento)))
      // Si el plazo ya se cumplió, nadie escucha esta promesa: que no quede un rechazo suelto.
      .catch(() => null);
    const plazo = new Promise<null>((resolve) => {
      temporizador = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([llamada, plazo]);
  } catch {
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

/** Lo que el panel le pide a `ecf-admin` (solo el super admin de la plataforma). */
export type PedidoEcfAdmin =
  | { accion: 'guardar_credenciales'; companyId: string; ambiente: AmbienteEcf; email: string; password: string; apiKey: string }
  | { accion: 'probar_conexion'; companyId: string; ambiente: AmbienteEcf };

export type RespuestaEcfAdmin = { ok: true; marcada?: boolean } | { ok: false; error: string };

const ERROR_ECF_ADMIN = 'No se pudo completar la operación. Intenta de nuevo.';

/**
 * Llama a `ecf-admin` y devuelve su respuesta; nunca lanza. La función contesta
 * `{ ok: false, error }` con el motivo en español, y cuando lo hace con un
 * status de error (400, 403, 500…) supabase-js entrega el cuerpo en
 * `error.context` (una `Response`), no en `data`.
 *
 * El pedido lleva la contraseña y la API key: no se registra ni se devuelve en
 * ningún mensaje.
 */
export async function administrarEcf(pedido: PedidoEcfAdmin): Promise<RespuestaEcfAdmin> {
  try {
    const { data, error } = await supabase.functions.invoke('ecf-admin', { body: pedido });
    if (!error && data && typeof data === 'object') {
      if (data.ok === true) return { ok: true, marcada: typeof data.marcada === 'boolean' ? data.marcada : undefined };
      if (data.ok === false && typeof data.error === 'string') return { ok: false, error: data.error };
    }
    const respuesta = (error as { context?: unknown } | null)?.context;
    if (respuesta instanceof Response) {
      const cuerpo = await respuesta.json().catch(() => null);
      if (cuerpo && typeof cuerpo.error === 'string') return { ok: false, error: cuerpo.error };
    }
    return { ok: false, error: ERROR_ECF_ADMIN };
  } catch {
    return { ok: false, error: ERROR_ECF_ADMIN };
  }
}
