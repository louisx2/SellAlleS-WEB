import { createClient } from 'jsr:@supabase/supabase-js@2';

// Provisiona una empresa demo efímera y aislada para el botón público
// "Probar Plataforma" de la landing. Sin sesión de por medio (llamada
// anónima): valida Turnstile + límite por IP, crea un usuario+empresa
// normales (mismo camino que un registro real, vía handle_new_user()),
// la marca como demo con expiración y la llena con datos de ejemplo.

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

const DEMO_DURATION_HOURS = 2;
const MAX_ATTEMPTS_PER_IP_PER_HOUR = 3;

function randomSuffix(len = 8) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, len);
}

function randomPassword() {
  return `Demo-${randomSuffix(10)}-${randomSuffix(4)}`;
}

async function verifyTurnstile(token: string, secret: string, remoteip: string | null) {
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteip) body.set('remoteip', remoteip);

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json().catch(() => ({ success: false }));
  return data?.success === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const body = await req.json().catch(() => null);
    const turnstileToken = body?.turnstileToken;
    if (!turnstileToken || typeof turnstileToken !== 'string') {
      return json(400, { error: 'Falta el token de verificación.' });
    }

    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
    if (!turnstileSecret) return json(500, { error: 'Función mal configurada (falta TURNSTILE_SECRET_KEY).' });

    // IP del visitante: puede venir de Cloudflare (cf-connecting-ip) o de un
    // proxy genérico (x-forwarded-for, toma la primera IP de la cadena).
    const ip =
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Límite por IP (segunda capa además de Turnstile).
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('demo_provision_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= MAX_ATTEMPTS_PER_IP_PER_HOUR) {
      return json(429, { error: 'Demasiados intentos. Intenta de nuevo más tarde.' });
    }

    const captchaOk = await verifyTurnstile(turnstileToken, turnstileSecret, ip === 'unknown' ? null : ip);
    if (!captchaOk) return json(400, { error: 'Verificación anti-bots inválida.' });

    await admin.from('demo_provision_attempts').insert({ ip });

    const suffix = randomSuffix(8);
    const email = `demo-${suffix}@mailinator.com`;
    const password = randomPassword();
    const companyName = `Empresa Demo ${suffix.slice(0, 4).toUpperCase()}`;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: 'Visitante Demo', company_name: companyName },
    });
    if (createErr || !created?.user) {
      return json(500, { error: createErr?.message ?? 'No se pudo crear la cuenta demo.' });
    }
    const userId = created.user.id;

    // handle_new_user() ya creó empresa+sucursal+suscripción+perfil admin
    // (vía create_company_for_user) porque mandamos company_name en los metadatos.
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('company_id')
      .eq('id', userId)
      .single();
    if (profileErr || !profile?.company_id) {
      await admin.auth.admin.deleteUser(userId);
      return json(500, { error: 'No se pudo resolver la empresa demo recién creada.' });
    }
    const companyId = profile.company_id as string;

    const { data: branch, error: branchErr } = await admin
      .from('branches')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .single();
    if (branchErr || !branch?.id) {
      await admin.auth.admin.deleteUser(userId);
      return json(500, { error: 'No se pudo resolver la sucursal demo recién creada.' });
    }

    const expiresAt = new Date(Date.now() + DEMO_DURATION_HOURS * 60 * 60 * 1000).toISOString();
    const { error: updateErr } = await admin
      .from('companies')
      .update({ demo_expires_at: expiresAt })
      .eq('id', companyId);
    if (updateErr) {
      await admin.auth.admin.deleteUser(userId);
      return json(500, { error: 'No se pudo marcar la empresa como demo.' });
    }

    const { error: seedErr } = await admin.rpc('seed_demo_company_data', {
      p_company_id: companyId,
      p_branch_id: branch.id,
    });
    if (seedErr) {
      await admin.auth.admin.deleteUser(userId);
      return json(500, { error: `No se pudieron cargar los datos de ejemplo: ${seedErr.message}` });
    }

    return json(200, { email, password, companyName, expiresAt });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
