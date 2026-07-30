import { createClient } from 'jsr:@supabase/supabase-js@2';

// Envía un correo con un link de un solo uso para fijar un PIN nuevo, cuando
// el cliente final olvidó el suyo. Requiere que tenga un email cargado en
// algún customers de una empresa con el módulo 'customer-portal' activo.

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
const TOKEN_MINUTES = 30;

function onlyDigits(s: string) {
  return (s || '').replace(/\D/g, '');
}

function wrapHtml(inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,Helvetica,sans-serif;color:#111111;">${inner}</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Función mal configurada (falta RESEND_API_KEY).');
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html: wrapHtml(html) }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Resend error: ${resp.status} ${errText}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const body = await req.json().catch(() => null);
    const cedula = onlyDigits(body?.cedula ?? '');
    if (cedula.length !== 11) return json(400, { error: 'La cédula debe tener 11 dígitos.' });

    const posUrl = Deno.env.get('POS_URL');
    if (!posUrl) return json(500, { error: 'Función mal configurada (falta POS_URL).' });

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

    const { data: moduleOk } = await admin.rpc('portal_customer_has_module_enabled', { p_cedula: cedula });
    if (!moduleOk) {
      return json(403, { error: 'El portal de clientes no está disponible para tu negocio todavía.' });
    }

    const { data: identity } = await admin
      .from('customer_portal_identities')
      .select('id')
      .eq('cedula', cedula)
      .maybeSingle();
    if (!identity) {
      return json(404, { error: 'No existe una cuenta para esta cédula.', needsSetup: true });
    }

    const { data: match } = await admin
      .from('customers')
      .select('email')
      .eq('rnc', cedula)
      .not('email', 'is', null)
      .limit(1)
      .maybeSingle();
    if (!match?.email) {
      return json(400, { error: 'No tenemos un correo registrado para verificarte. Contacta al negocio.' });
    }

    const expiresAt = new Date(Date.now() + TOKEN_MINUTES * 60 * 1000).toISOString();
    const { data: tokenRow, error: tokenErr } = await admin
      .from('customer_portal_reset_tokens')
      .insert({ identity_id: identity.id, expires_at: expiresAt })
      .select('token')
      .single();
    if (tokenErr || !tokenRow) return json(500, { error: 'No se pudo generar el enlace.' });

    const link = `${posUrl}/mi-prestamo?resetToken=${tokenRow.token}`;
    const subject = 'Recupera el acceso a tu Estado de Cuenta';
    const html =
      `<p>Recibimos una solicitud para recuperar el acceso a tu estado de cuenta (préstamos y compras a crédito/financiadas).</p>` +
      `<p><a href="${link}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Crear un PIN nuevo</a></p>` +
      `<p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>` +
      `<p><a href="${link}">${link}</a></p>` +
      `<p>Este enlace vence en ${TOKEN_MINUTES} minutos y solo funciona una vez.</p>` +
      `<p>Si no fuiste tú quien solicitó esto, ignora este correo.</p>`;
    try {
      await sendEmail(match.email, subject, html);
    } catch (e) {
      return json(500, { error: `No se pudo enviar el correo: ${(e as Error).message}` });
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
