import type { EcfDocumento } from '@/lib/types';
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
