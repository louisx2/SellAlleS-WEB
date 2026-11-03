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
import { administrar, ERROR_INTERNO } from '../_shared/ecf/admin.ts';

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

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Método no permitido.' });

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

    // Validar el pedido, guardar las credenciales y probar la conexión: _shared/ecf/admin.ts.
    const body = await req.json().catch(() => null);
    const r = await administrar(admin, body, {
      fetch,
      ahora: () => new Date(),
      registrar: (texto) => console.error(texto),
    });
    return json(r.status, r.cuerpo);
  } catch (e) {
    // Solo llega aquí si falló la comprobación de quién llama: todavía no se
    // leyó nada del pedido, así que no hay secretos que cuidar.
    console.error('ecf-admin:', mensajeDe(e));
    return json(500, { ok: false, error: ERROR_INTERNO });
  }
});
