import { supabase } from '@/lib/supabase/client';
import type { RespuestaRnc } from '@/lib/rnc';

const NO_RESPONDE: RespuestaRnc = { ok: false, motivo: 'dgii_no_responde' };

/**
 * Consulta un RNC o una cédula en la DGII con la función `dgii-rnc`. Nunca
 * lanza: ante cualquier fallo (red, sesión, la función o la DGII) responde
 * "no responde", y la pantalla deja escribir el nombre a mano.
 */
export async function consultarRncDgii(rnc: string): Promise<RespuestaRnc> {
  try {
    const { data, error } = await supabase.functions.invoke('dgii-rnc', { body: { rnc } });
    if (error || !data || typeof data !== 'object') return NO_RESPONDE;
    if (data.ok === true && data.encontrado === true && data.datos && typeof data.datos === 'object') {
      return {
        ok: true,
        encontrado: true,
        datos: data.datos,
        consultadoAt: String(data.consultadoAt ?? ''),
        desactualizado: data.desactualizado === true,
      };
    }
    if (data.ok === true && data.encontrado === false) return { ok: true, encontrado: false };
    if (data.ok === false && data.motivo === 'documento_invalido') return { ok: false, motivo: 'documento_invalido' };
    return NO_RESPONDE;
  } catch {
    return NO_RESPONDE;
  }
}
