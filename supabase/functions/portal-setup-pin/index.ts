import { createClient } from 'jsr:@supabase/supabase-js@2';

// Alta de PIN por autoservicio para el portal público "Mi Préstamo": el
// cliente final valida su cédula + el teléfono que el negocio tiene registrado
// en su expediente, y crea su PIN. Sin SMS/email (no existe esa infra hoy).
// El portal es un módulo opt-in que solo el super admin activa por empresa
// (company_modules 'customer-portal'); si ninguna empresa coincidente lo tiene
// activo, se rechaza el alta.

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

const MAX_ATTEMPTS_PER_IP_PER_HOUR = 5;

function onlyDigits(s: string) {
  return (s || '').replace(/\D/g, '');
}

// Compara los últimos 10 dígitos (tolera prefijo de país distinto guardado).
function phonesMatch(a: string, b: string) {
  const da = onlyDigits(a).slice(-10);
  const db = onlyDigits(b).slice(-10);
  return da.length === 10 && da === db;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const body = await req.json().catch(() => null);
    const cedula = onlyDigits(body?.cedula ?? '');
    const phone = String(body?.phone ?? '').trim();
    const newPin = String(body?.newPin ?? '').trim();

    if (cedula.length !== 11) return json(400, { error: 'La cédula debe tener 11 dígitos.' });
    if (!phone) return json(400, { error: 'Falta el teléfono.' });
    if (!/^\d{6,}$/.test(newPin)) return json(400, { error: 'El PIN debe tener al menos 6 dígitos.' });

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
      return json(429, { error: 'Demasiados intentos. Intenta de nuevo más tarde.' });
    }
    await admin.from('portal_login_attempts').insert({ ip });

    const { data: existing } = await admin
      .from('customer_portal_identities')
      .select('id')
      .eq('cedula', cedula)
      .maybeSingle();
    if (existing) {
      return json(409, { error: 'Esta cédula ya tiene una cuenta. Inicia sesión con tu PIN.' });
    }

    const { data: moduleOk, error: moduleErr } = await admin.rpc('portal_customer_has_module_enabled', {
      p_cedula: cedula,
    });
    if (moduleErr) return json(500, { error: 'Error verificando disponibilidad del portal.' });
    if (!moduleOk) {
      return json(403, { error: 'El portal de clientes no está disponible para tu negocio todavía.' });
    }

    // Busca clientes (de cualquier empresa) con esa cédula en rnc, y confirma
    // que el teléfono dado coincide con el registrado en al menos uno.
    const { data: matches, error: matchErr } = await admin
      .from('customers')
      .select('id, phone')
      .eq('rnc', cedula);
    if (matchErr) return json(500, { error: 'Error verificando la cédula.' });

    const verified = (matches ?? []).some((c) => phonesMatch(c.phone ?? '', phone));
    if (!verified) {
      return json(400, { error: 'No pudimos verificar tu identidad con esos datos.' });
    }

    const { error: createErr } = await admin.rpc('portal_create_identity', {
      p_cedula: cedula,
      p_pin: newPin,
      p_phone: phone,
    });
    if (createErr) return json(500, { error: 'No se pudo crear el PIN.' });

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
