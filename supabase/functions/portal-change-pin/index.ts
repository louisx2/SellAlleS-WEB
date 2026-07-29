import { createClient } from 'jsr:@supabase/supabase-js@2';

// El cliente final cambia su propio PIN desde el portal (sesión ya activa).
// Requiere el PIN actual para evitar que alguien con la sesión abierta en un
// dispositivo compartido lo cambie sin saber el PIN vigente.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const body = await req.json().catch(() => null);
    const sessionToken = body?.sessionToken;
    const oldPin = String(body?.oldPin ?? '').trim();
    const newPin = String(body?.newPin ?? '').trim();

    if (!sessionToken) return json(400, { error: 'Falta la sesión.' });
    if (!oldPin) return json(400, { error: 'Falta el PIN actual.' });
    if (!/^\d{6,}$/.test(newPin)) return json(400, { error: 'El PIN nuevo debe tener al menos 6 dígitos.' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: session, error: sessionErr } = await admin
      .from('customer_portal_sessions')
      .select('identity_id, expires_at')
      .eq('token', sessionToken)
      .maybeSingle();
    if (sessionErr || !session) return json(401, { error: 'Sesión inválida.' });
    if (new Date(session.expires_at) < new Date()) {
      return json(401, { error: 'Sesión expirada. Inicia sesión de nuevo.' });
    }

    const { data: identity, error: identityErr } = await admin
      .from('customer_portal_identities')
      .select('cedula')
      .eq('id', session.identity_id)
      .maybeSingle();
    if (identityErr || !identity) return json(401, { error: 'Sesión inválida.' });

    const { data: pinOk, error: verifyErr } = await admin.rpc('portal_verify_pin', {
      p_cedula: identity.cedula,
      p_pin: oldPin,
    });
    if (verifyErr) return json(500, { error: 'Error verificando el PIN.' });
    if (!pinOk) return json(401, { error: 'El PIN actual no es correcto.' });

    const { error: setErr } = await admin.rpc('portal_set_pin', {
      p_cedula: identity.cedula,
      p_pin: newPin,
    });
    if (setErr) return json(500, { error: 'No se pudo actualizar el PIN.' });

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
