import { createClient } from 'jsr:@supabase/supabase-js@2';

// Envía un correo de recibo al cliente tras un abono (préstamo o crédito).
// Best-effort: si el cliente no tiene email, o Resend falla, no revierte nada
// (el pago ya quedó registrado antes de llamar esta función).

// x-impersonate-company va en la lista porque el cliente la manda en TODAS sus
// peticiones mientras un super admin está dentro de una empresa (ver
// lib/supabase/client.ts). Si el preflight no la autoriza, el navegador bloquea
// la petición real: en el log se ve el OPTIONS y ningún POST, y al usuario le
// llega un "Failed to send a request to the Edge Function" que no dice nada.
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

function formatCurrency(n: number) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(n);
}

function wrapHtml(inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,Helvetica,sans-serif;color:#111111;">${inner}</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Falta RESEND_API_KEY.');
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
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json(401, { error: 'Sesión inválida.' });

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_super_admin, company_id')
      .eq('id', callerData.user.id)
      .single();
    if (!callerProfile) return json(403, { error: 'Perfil no encontrado.' });

    const body = await req.json().catch(() => null);
    const customerId = body?.customerId;
    const amount = Number(body?.amount ?? 0);
    const lateFeePaid = Number(body?.lateFeePaid ?? 0);
    const remainingBalance = Number(body?.remainingBalance ?? 0);
    const kind = body?.kind === 'loan' ? 'préstamo' : 'cuenta';
    if (!customerId || !amount) return json(400, { error: 'Solicitud inválida.' });

    const { data: customer } = await admin
      .from('customers')
      .select('id, name, email, company_id')
      .eq('id', customerId)
      .single();
    if (!customer) return json(200, { ok: true, skipped: true });

    const isSuper = callerProfile.is_super_admin === true;
    if (!isSuper && callerProfile.company_id !== customer.company_id) {
      return json(403, { error: 'No tienes permiso para esta acción.' });
    }

    if (!customer.email) return json(200, { ok: true, skipped: true });

    const { data: company } = await admin
      .from('companies')
      .select('name')
      .eq('id', customer.company_id)
      .single();

    try {
      await sendEmail(
        customer.email,
        `Recibo de pago — ${company?.name ?? 'SellAlleS'}`,
        `<p>Hola ${customer.name},</p>` +
          `<p>Recibimos tu abono de <strong>${formatCurrency(amount)}</strong>` +
          (lateFeePaid > 0 ? ` (incluye ${formatCurrency(lateFeePaid)} de mora)` : '') +
          ` a tu ${kind} con ${company?.name ?? 'el negocio'}.</p>` +
          `<p>Saldo pendiente: <strong>${formatCurrency(remainingBalance)}</strong></p>` +
          `<p>Gracias por tu pago.</p>`,
      );
    } catch (e) {
      // Best-effort: no revertir el pago si el correo falla.
      return json(200, { ok: true, emailError: String((e as Error).message) });
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
