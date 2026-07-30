import { createClient } from 'jsr:@supabase/supabase-js@2';

// Devuelve los préstamos y ventas a crédito/financiadas del cliente final ya
// autenticado (sessionToken emitido por portal-login), en todas las empresas
// donde su cédula figure como cliente. Solo lectura.

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
    if (!sessionToken || typeof sessionToken !== 'string') {
      return json(400, { error: 'Falta la sesión.' });
    }

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

    const { data: businesses, error: resolveErr } = await admin.rpc('resolve_portal_customers', {
      p_cedula: identity.cedula,
    });
    if (resolveErr) return json(500, { error: 'No se pudo cargar la información.' });

    return json(200, { businesses: businesses ?? [] });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
