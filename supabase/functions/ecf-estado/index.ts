// ecf-estado: pregunta a MSeller cómo van los e-CF que la DGII aún no respondió
// (estado `recibido`) y guarda lo que conteste: aceptado, aceptado condicional,
// rechazado con sus mensajes, o error.
//
// Quién lo llama: solo el cron de la base (ecf_disparar_consultas, cada 15
// minutos) con la service role key. Cualquier otra llave o sesión recibe 403.
// El cuerpo se ignora: la base decide qué toca consultar (ecf_consultas_pendientes,
// que respeta el tiempo entre consultas del plan de cada empresa).
//
// Qué hace: deja que `consultarPendientes` (módulo puro, con pruebas) haga una
// consulta en lote por empresa y actualice cada documento. Aquí solo está lo que
// toca Supabase y la red: las RPC del servidor, las filas y la respuesta HTTP.
//
// Las credenciales de MSeller nunca salen de aquí: se leen con la service role
// (ecf_leer_credenciales), se usan en memoria y no se devuelven ni se registran.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { consultarPendientes } from '../_shared/ecf/estado.ts';
import type { CambioConsulta, DepsEstado, GrupoPendiente } from '../_shared/ecf/estado.ts';
import type { Ambiente } from '../_shared/ecf/mseller.ts';
import { guardarSesion, leerCredenciales, sumarUso } from '../_shared/ecf/rpc.ts';

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Cliente = SupabaseClient;

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Compara sin cortar en la primera diferencia, para que el tiempo no delate cuánto acertó quien llama. */
function mismaLlave(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

// ---------------------------------------------------------------------------
// Dependencias del seguimiento (RPC del servidor y tablas, siempre con la service role)
// ---------------------------------------------------------------------------

function crearDeps(admin: Cliente): DepsEstado {
  return {
    pendientes: async () => {
      const { data, error } = await admin.rpc('ecf_consultas_pendientes');
      if (error) throw new Error(`No se pudo leer qué documentos consultar: ${error.message}`);
      const filas = (Array.isArray(data) ? data : []) as Array<{
        company_id: string;
        ambiente: string;
        encfs: string[] | null;
      }>;

      const grupos: GrupoPendiente[] = [];
      for (const f of filas) {
        const encfs = f.encfs ?? [];
        if (encfs.length === 0) continue;
        // Cuáles siguen sin QR (el envío contestó incompleto): a esos se les
        // completa con lo que traiga la consulta. De mejor esfuerzo.
        const { data: sinQr, error: sinQrErr } = await admin
          .from('ecf_documentos')
          .select('encf')
          .eq('company_id', f.company_id)
          .in('encf', encfs)
          .is('qr_url', null);
        if (sinQrErr) console.error('ecf-estado: no se pudo ver qué documentos no tienen QR:', sinQrErr.message);
        grupos.push({
          companyId: f.company_id,
          ambiente: f.ambiente as Ambiente,
          encfs,
          sinQr: ((sinQr ?? []) as Array<{ encf: string }>).map((r) => r.encf),
        });
      }
      return grupos;
    },

    leerCredenciales: (companyId, ambiente) => leerCredenciales(admin, companyId, ambiente),

    guardarSesion: (companyId, ambiente, s) => guardarSesion(admin, companyId, ambiente, s),

    actualizar: async (companyId, encf, cambio: CambioConsulta) => {
      // Solo si el documento sigue `recibido`: si otro ya le cambió el estado,
      // esta consulta llegó tarde y no debe pisarlo.
      const { error } = await admin
        .from('ecf_documentos')
        .update({ ...cambio, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('encf', encf)
        .eq('estado', 'recibido');
      if (error) throw new Error(`No se pudo guardar el estado del documento: ${error.message}`);
    },

    marcarConsultados: async (companyId, ambiente, encfs, cuando) => {
      // MSeller contestó el lote con un error: solo la marca de consulta, para
      // que la próxima espere el intervalo del plan. Lo que ya cambió de estado no se toca.
      const { error } = await admin
        .from('ecf_documentos')
        .update({ ultima_consulta_at: cuando, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('ambiente', ambiente)
        .in('encf', encfs)
        .eq('estado', 'recibido');
      if (error) throw new Error(`No se pudo marcar la consulta: ${error.message}`);
    },

    sumarUso: (companyId, requests, comprobantes) => sumarUso(admin, companyId, requests, comprobantes),

    avisarSinCupo: async (companyId) => {
      const { error } = await admin.rpc('ecf_avisar_sin_cupo', { p_company: companyId });
      if (error) throw new Error(`No se pudo avisar de la falta de cupo: ${error.message}`);
    },

    fetch,
    ahora: () => new Date(),
  };
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'No autorizado.' });

    // Solo la service role key: esto lo corre el cron, no una persona.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey || !mismaLlave(token, serviceKey)) {
      return json(403, { error: 'Solo el sistema puede consultar el estado de los comprobantes.' });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
    const resultado = await consultarPendientes(crearDeps(admin));
    return json(200, resultado);
  } catch (e) {
    // Solo llega aquí si falló la base al leer qué consultar: MSeller y sus
    // errores ya quedaron en el registro. El mensaje no lleva secretos.
    console.error('ecf-estado:', mensajeDe(e));
    return json(500, { error: 'No se pudo consultar el estado de los comprobantes.' });
  }
});
