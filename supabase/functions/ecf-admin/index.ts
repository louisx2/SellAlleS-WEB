// ecf-admin: lo que el panel de SellAlleS le pide a la plataforma para dejar una
// empresa lista para emitir e-CF con MSeller. Solo el super admin de la
// plataforma (el mismo chequeo de send-lifecycle-email: la sesión del usuario y
// profiles.is_super_admin); ni la service role key ni un usuario de empresa.
//
// Cuerpo: { accion, companyId, ambiente, ... } con ambiente TesteCF, CerteCF o eCF.
//   * guardar_credenciales { email, password, apiKey }: las escribe en Vault con
//     ecf_guardar_credenciales (la base apunta a ellas y olvida la sesión de las
//     anteriores). Responde { ok: true }.
//   * probar_conexion: inicia sesión con la contraseña (siempre un login nuevo,
//     no reutiliza ni renueva la sesión guardada), guarda la sesión y, si el
//     ambiente probado es el de la empresa, marca ecf_config.conexion_probada_at:
//     es lo que deja activarla (ecf_cambiar_estado). No hace ninguna llamada
//     que gaste cupo. Responde { ok: true, marcada } o, si MSeller no la acepta,
//     { ok: false, error } con el motivo en español.
//
// Las credenciales nunca vuelven al navegador: ninguna respuesta, mensaje de
// error ni registro lleva la contraseña, la API key ni los tokens (lo que diga
// MSeller se limpia antes de contestar).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { MsellerError, sesionVigente } from '../_shared/ecf/mseller.ts';
import type { Ambiente } from '../_shared/ecf/mseller.ts';
import { guardarSesion, leerCredenciales } from '../_shared/ecf/rpc.ts';

// x-impersonate-company va en la lista porque el cliente la manda en todas sus
// peticiones mientras el super admin está dentro de una empresa (ver
// lib/supabase/client.ts); sin ella el navegador bloquea el POST en el preflight.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-impersonate-company',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMBIENTES: Ambiente[] = ['TesteCF', 'CerteCF', 'eCF'];
// Igual que en mseller.ts y emitir.ts: un secreto más corto no se puede buscar sin estropear el texto.
const MIN_SECRETO = 4;

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Cambia cada secreto que aparezca en `texto` por `***`. */
function ocultar(texto: string, secretos: Array<string | null | undefined>): string {
  let r = texto;
  for (const s of secretos) {
    if (s && s.length >= MIN_SECRETO) r = r.split(s).join('***');
  }
  return r;
}

/** El motivo, en español, por el que no se pudo iniciar sesión. */
function motivoDe(e: unknown): string {
  if (e instanceof MsellerError) {
    // En un 400 o 422 el mensaje es el cuerpo que mandó MSeller, a menudo en
    // inglés y sin contexto: se aclara de qué se trata. Los demás ya dicen
    // "MSeller ..." en español.
    return e.tipo === 'datos' ? `MSeller no aceptó el inicio de sesión: ${e.message}` : e.message;
  }
  return mensajeDe(e);
}

type Respuesta =
  | { ok: true; marcada: boolean }
  | { ok: false; error: string };

/**
 * Inicia sesión en MSeller con las credenciales guardadas y deja la sesión
 * guardada. Un fallo de MSeller (o de la base) no lanza: vuelve como `ok: false`
 * con un motivo sin secretos.
 */
async function probarConexion(
  admin: SupabaseClient,
  companyId: string,
  ambiente: Ambiente,
): Promise<Respuesta> {
  const secretos: Array<string | null> = [];
  try {
    const cred = await leerCredenciales(admin, companyId, ambiente);
    secretos.push(cred.password, cred.apiKey, cred.refreshToken, cred.idToken);

    // Un login nuevo con la contraseña: sin idToken, vencimiento ni refreshToken
    // no queda sesión que reutilizar ni renovar, y lo que se prueba es la cuenta.
    const { sesion } = await sesionVigente(
      { ...cred, idToken: null, idTokenVence: null, refreshToken: null },
      ambiente,
      fetch,
      new Date(),
    );
    // Antes de guardarla: si guardar falla, el mensaje no puede dejar salir los tokens nuevos.
    secretos.push(sesion.idToken, sesion.refreshToken);
    await guardarSesion(admin, companyId, ambiente, sesion);

    // La marca vale para el ambiente en uso de la empresa: probar otro (p. ej.
    // CerteCF antes de pasar a eCF) no la pone, porque el disparador de
    // ecf_config la borraría al cambiar de ambiente.
    const { data, error } = await admin
      .from('ecf_config')
      .update({ conexion_probada_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('ambiente', ambiente)
      .select('company_id');
    if (error) throw new Error(`No se pudo marcar la conexión como probada: ${error.message}`);
    return { ok: true, marcada: Array.isArray(data) && data.length > 0 };
  } catch (e) {
    // Un fallo de MSeller es un resultado esperado de la prueba; cualquier otro
    // (la base) además queda en el registro, con el mismo texto sin secretos.
    const error = ocultar(motivoDe(e), secretos);
    if (!(e instanceof MsellerError)) console.error('ecf-admin: probar_conexion:', error);
    return { ok: false, error };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Método no permitido.' });

  // Lo que mande el panel que no se puede dejar salir si algo falla.
  let secretosDelPedido: string[] = [];

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { ok: false, error: 'No autorizado.' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    // Solo el super admin de la plataforma, con su sesión.
    const { data: quien, error: quienErr } = await admin.auth.getUser(token);
    if (quienErr || !quien?.user) return json(401, { ok: false, error: 'Sesión inválida.' });
    const { data: perfil, error: perfilErr } = await admin
      .from('profiles')
      .select('is_super_admin')
      .eq('id', quien.user.id)
      .maybeSingle();
    if (perfilErr) throw new Error(`No se pudo comprobar el perfil: ${perfilErr.message}`);
    if (!perfil?.is_super_admin) {
      return json(403, { ok: false, error: 'Solo el administrador de la plataforma puede administrar la facturación electrónica.' });
    }

    const body = await req.json().catch(() => null);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json(400, { ok: false, error: 'Solicitud inválida.' });
    }
    const { accion, companyId, ambiente } = body as Record<string, unknown>;
    if (typeof companyId !== 'string' || !UUID.test(companyId)) {
      return json(400, { ok: false, error: 'La empresa no es válida.' });
    }
    if (typeof ambiente !== 'string' || !AMBIENTES.includes(ambiente as Ambiente)) {
      return json(400, { ok: false, error: 'El ambiente debe ser TesteCF, CerteCF o eCF.' });
    }
    const amb = ambiente as Ambiente;

    if (accion === 'guardar_credenciales') {
      const { email, password, apiKey } = body as Record<string, unknown>;
      secretosDelPedido = [password, apiKey].filter((x): x is string => typeof x === 'string');
      if (typeof email !== 'string' || email.trim() === '') {
        return json(400, { ok: false, error: 'Falta el correo de la cuenta de MSeller.' });
      }
      if (typeof password !== 'string' || password === '') {
        return json(400, { ok: false, error: 'Falta la contraseña de la cuenta de MSeller.' });
      }
      if (typeof apiKey !== 'string' || apiKey === '') {
        return json(400, { ok: false, error: 'Falta la API key de MSeller.' });
      }

      const { data: empresa, error: empresaErr } = await admin
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle();
      if (empresaErr) throw new Error(`No se pudo comprobar la empresa: ${empresaErr.message}`);
      if (!empresa) return json(404, { ok: false, error: 'La empresa no existe.' });

      const { error } = await admin.rpc('ecf_guardar_credenciales', {
        p_company: companyId,
        p_ambiente: amb,
        p_email: email,
        p_password: password,
        p_api_key: apiKey,
      });
      if (error) throw new Error(`No se pudieron guardar las credenciales: ${error.message}`);
      return json(200, { ok: true });
    }

    if (accion === 'probar_conexion') {
      return json(200, await probarConexion(admin, companyId, amb));
    }

    return json(400, { ok: false, error: 'Acción desconocida. Usa guardar_credenciales o probar_conexion.' });
  } catch (e) {
    // Solo llega aquí si falló la base o la red del propio panel. Nada de lo
    // que mandó el panel (contraseña, API key) puede salir en el registro.
    console.error('ecf-admin:', ocultar(mensajeDe(e), secretosDelPedido));
    return json(500, { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' });
  }
});
