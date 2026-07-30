import { createClient } from 'jsr:@supabase/supabase-js@2';

// Consume el token de un solo uso enviado por portal-forgot-pin y fija el PIN
// nuevo elegido por el cliente.

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
    const token = body?.token;
    const newPin = String(body?.newPin ?? '').trim();
    if (!token) return json(400, { error: 'Falta el enlace de recuperación.' });
    if (!/^\d{6,}$/.test(newPin)) return json(400, { error: 'El PIN debe tener al menos 6 dígitos.' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: tokenRow, error: tokenErr } = await admin
      .from('customer_portal_reset_tokens')
      .select('identity_id, expires_at, used_at')
      .eq('token', token)
      .maybeSingle();
    if (tokenErr || !tokenRow) return json(400, { error: 'Enlace inválido.' });
    if (tokenRow.used_at) return json(400, { error: 'Este enlace ya fue usado.' });
    if (new Date(tokenRow.expires_at) < new Date()) return json(400, { error: 'Este enlace expiró.' });

    const { data: identity, error: identityErr } = await admin
      .from('customer_portal_identities')
      .select('cedula')
      .eq('id', tokenRow.identity_id)
      .maybeSingle();
    if (identityErr || !identity) return json(400, { error: 'Enlace inválido.' });

    const { error: setErr } = await admin.rpc('portal_set_pin', {
      p_cedula: identity.cedula,
      p_pin: newPin,
    });
    if (setErr) return json(500, { error: 'No se pudo actualizar el PIN.' });

    await admin
      .from('customer_portal_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
