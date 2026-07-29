import { createClient } from 'jsr:@supabase/supabase-js@2';

// Login del portal público "Mi Préstamo": cédula + PIN → sesión corta y opaca.
// Doble capa de bloqueo: por IP (portal_login_attempts) y por cédula
// (failed_attempts/locked_until en customer_portal_identities).
// Si el body trae solo { cedula } (sin pin), es un "probe": solo informa si
// esa cédula ya tiene cuenta (needsSetup), sin consumir intentos fallidos.

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

const MAX_ATTEMPTS_PER_IP_PER_HOUR = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_MINUTES = 45;

function onlyDigits(s: string) {
  return (s || '').replace(/\D/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const body = await req.json().catch(() => null);
    const cedula = onlyDigits(body?.cedula ?? '');
    const pin = String(body?.pin ?? '').trim();

    if (cedula.length !== 11) return json(400, { error: 'La cédula debe tener 11 dígitos.' });

    const ip =
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('portal_login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= MAX_ATTEMPTS_PER_IP_PER_HOUR) {
      return json(429, { error: 'Demasiados intentos desde esta conexión. Intenta más tarde.' });
    }
    await admin.from('portal_login_attempts').insert({ ip });

    const { data: identity, error: identityErr } = await admin
      .from('customer_portal_identities')
      .select('id, failed_attempts, locked_until')
      .eq('cedula', cedula)
      .maybeSingle();
    if (identityErr) return json(500, { error: 'Error verificando la cuenta.' });

    // Modo "probe": el frontend solo quiere saber si ya existe cuenta para
    // decidir qué pantalla mostrar. No verifica PIN ni cuenta intentos fallidos.
    if (!pin) {
      return json(200, { needsSetup: !identity });
    }

    if (!identity) {
      return json(404, { error: 'No existe una cuenta para esta cédula. Crea tu PIN primero.', needsSetup: true });
    }

    if (identity.locked_until && new Date(identity.locked_until) > new Date()) {
      return json(423, { error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.' });
    }

    const { data: pinOk, error: verifyErr } = await admin.rpc('portal_verify_pin', {
      p_cedula: cedula,
      p_pin: pin,
    });
    if (verifyErr) return json(500, { error: 'Error verificando el PIN.' });

    if (!pinOk) {
      const attempts = (identity.failed_attempts ?? 0) + 1;
      const patch: Record<string, unknown> = { failed_attempts: attempts };
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
        patch.failed_attempts = 0;
      }
      await admin.from('customer_portal_identities').update(patch).eq('id', identity.id);
      return json(401, { error: 'Cédula o PIN incorrecto.' });
    }

    // PIN correcto: limpiar contador de fallos y emitir sesión.
    await admin.from('customer_portal_identities').update({ failed_attempts: 0, locked_until: null }).eq('id', identity.id);

    const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60 * 1000).toISOString();
    const { data: session, error: sessionErr } = await admin
      .from('customer_portal_sessions')
      .insert({ identity_id: identity.id, expires_at: expiresAt })
      .select('token, expires_at')
      .single();
    if (sessionErr || !session) return json(500, { error: 'No se pudo iniciar sesión.' });

    return json(200, { sessionToken: session.token, expiresAt: session.expires_at });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
