import { createClient } from 'jsr:@supabase/supabase-js@2';

// Notifica por correo a admins/gerentes (y a los correos adicionales
// configurados por la empresa) cuando se abre o cierra una caja.
// Best-effort: se invoca fire-and-forget desde el frontend; nunca bloquea la
// operación de caja. Gate real (activado/desactivado) es server-side.
// El HTML reutiliza el mismo diseño de marca (azul/naranja) que las
// plantillas de Supabase Auth, para que todos los correos luzcan igual.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(Number(n || 0));
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

const SHELL = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<style>
  body { background-color:#f3f4f6; font-family:'PT Sans',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; margin:0; padding:0; -webkit-font-smoothing:antialiased; }
  .wrapper { width:100%; background-color:#f3f4f6; padding:40px 0; }
  .main-table { background-color:#ffffff; margin:0 auto; width:100%; max-width:600px; border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,.05),0 2px 4px -1px rgba(0,0,0,.03); border-spacing:0; overflow:hidden; }
  .header { background-color:#30A8DE; padding:40px 30px; text-align:center; }
  .header h1 { color:#ffffff; font-size:26px; margin:0; font-weight:700; letter-spacing:-.5px; }
  .content { padding:40px 30px; color:#1f2937; line-height:1.6; }
  .content p { font-size:16px; margin-top:0; margin-bottom:20px; }
  .data-table { border-collapse:collapse; font-size:14px; width:100%; margin-top:10px; }
  .data-table td { padding:8px 12px 8px 0; }
  .data-table td:first-child { color:#6b7280; white-space:nowrap; }
  .footer { background-color:#f9fafb; padding:30px; text-align:center; font-size:12px; color:#6b7280; border-top:1px solid #f3f4f6; }
  .footer a { color:#30A8DE; text-decoration:none; }
  .warning-box { background-color:#eff6ff; border-left:4px solid #30A8DE; padding:15px; border-radius:0 8px 8px 0; margin-top:25px; font-size:14px; color:#1e3a8a; }
  .alert-box { background-color:#fff7ed; border-left:4px solid #FF9E00; padding:15px; border-radius:0 8px 8px 0; margin-top:25px; font-size:14px; color:#9a3412; }
</style>
</head>
<body>
  <center class="wrapper">
    <table class="main-table" width="100%">
      <tr><td class="header"><h1>__HEADER__</h1></td></tr>
      <tr><td class="content">__BODY__</td></tr>
      <tr><td class="footer">
        <p>&copy; 2026 SellAlleS POS. Todos los derechos reservados.</p>
        <p>Este es un correo autom&aacute;tico, por favor no respondas a este mensaje.</p>
        <p>&iquest;Necesitas ayuda? <a href="mailto:soporte@sellalles.com">Contactar a soporte</a></p>
      </td></tr>
    </table>
  </center>
</body>
</html>`;

function build(title: string, header: string, body: string) {
  return SHELL.replace('__TITLE__', title).replace('__HEADER__', header).replace('__BODY__', body);
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Falta RESEND_API_KEY.');
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Resend error: ${resp.status} ${errText}`);
  }
}

function diffLabel(d: number) {
  if (Math.abs(d) < 0.01) return 'Cuadra';
  return d < 0 ? 'Faltante' : 'Sobrante';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const sessionId = body?.sessionId;
    const kind = body?.kind === 'close' ? 'close' : 'open';
    if (!sessionId) return json(400, { error: 'Solicitud inválida.' });

    const { data: session } = await admin
      .from('caja_sessions')
      .select('*, branches(name), companies(name, caja_email_enabled, caja_email_recipients)')
      .eq('id', sessionId)
      .single();
    if (!session) return json(200, { ok: true, skipped: true });

    const isSuper = callerProfile.is_super_admin === true;
    if (!isSuper && callerProfile.company_id !== session.company_id) {
      return json(403, { error: 'No tienes permiso para esta acción.' });
    }

    // Gate: la empresa debe tener activado el correo y el módulo caja.
    const company: any = session.companies;
    if (!company?.caja_email_enabled) return json(200, { ok: true, skipped: true, reason: 'disabled' });
    const { data: moduleOk } = await admin.rpc('is_module_enabled', {
      p_company_id: session.company_id, p_module_key: 'caja', p_default: false,
    });
    if (!moduleOk) return json(200, { ok: true, skipped: true, reason: 'module_off' });

    // Destinatarios: admins de empresa, usuarios con rol 'gerente', y los
    // correos adicionales configurados manualmente en companies.caja_email_recipients.
    const { data: profiles } = await admin
      .from('profiles')
      .select('email, name, role, profile_roles(roles(name, key))')
      .eq('company_id', session.company_id)
      .not('email', 'is', null);

    const isManager = (p: any) =>
      (p.profile_roles ?? []).some((pr: any) => {
        const r = pr.roles;
        if (!r) return false;
        const n = (r.name ?? '').toLowerCase();
        const k = (r.key ?? '').toLowerCase();
        return n.includes('gerente') || k.includes('gerente');
      });
    const roleRecipients = (profiles ?? [])
      .filter((p: any) => p.email && (p.role === 'admin' || isManager(p)))
      .map((p: any) => ({ email: String(p.email).trim(), name: p.name as string }));

    const configuredRecipients: { email: string; name?: string }[] = (company?.caja_email_recipients ?? [])
      .filter((e: unknown) => typeof e === 'string' && EMAIL_RE.test(e.trim()))
      .map((e: string) => ({ email: e.trim() }));

    const seen = new Set<string>();
    const recipients: { email: string; name?: string }[] = [];
    for (const r of [...roleRecipients, ...configuredRecipients]) {
      const key = r.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(r);
    }

    if (recipients.length === 0) return json(200, { ok: true, sent: 0, skipped: true, reason: 'no_recipients' });

    const branchName = (session.branches as any)?.name ?? 'Sucursal';
    const companyName = company?.name ?? 'SellAlleS';
    const row = (label: string, value: string, strong = false) =>
      `<tr><td>${label}</td><td${strong ? ' style="font-weight:bold;"' : ''}>${value}</td></tr>`;

    let subject = '';
    let title = '';
    let header = '';
    let inner = '';
    if (kind === 'open') {
      subject = `Caja abierta — ${branchName} (${companyName})`;
      title = 'Caja abierta';
      header = 'Caja abierta';
      inner =
        `<p>Se abrió una caja en <strong>${companyName}</strong>. Este es el resumen:</p>` +
        `<table class="data-table">` +
        row('Sucursal', branchName) +
        row('Abierta por', session.opened_by_name ?? '—') +
        row('Fecha/hora', fmtDate(session.opened_at)) +
        row('Monto inicial', fmt(session.opening_amount), true) +
        `</table>` +
        (session.notes ? `<div class="warning-box">Notas: ${String(session.notes)}</div>` : '');
    } else {
      const diff = Number(session.difference ?? 0);
      const label = diffLabel(diff);
      subject = `Caja cerrada — ${branchName} (${companyName})`;
      title = 'Caja cerrada';
      header = 'Caja cerrada';
      inner =
        `<p>Se cerró una caja en <strong>${companyName}</strong>. Este es el resumen:</p>` +
        `<table class="data-table">` +
        row('Sucursal', branchName) +
        row('Abierta por', session.opened_by_name ?? '—') +
        row('Cerrada por', session.closed_by_name ?? '—') +
        row('Apertura', fmtDate(session.opened_at)) +
        row('Cierre', fmtDate(session.closed_at)) +
        row('Monto inicial', fmt(session.opening_amount)) +
        row('Esperado en caja', fmt(session.closing_amount_expected)) +
        row('Declarado (contado)', fmt(session.closing_amount_declared)) +
        `</table>` +
        `<div class="${label === 'Cuadra' ? 'warning-box' : 'alert-box'}">${label}: ${fmt(Math.abs(diff))}</div>` +
        (session.notes ? `<div class="warning-box">Notas: ${String(session.notes)}</div>` : '');
    }

    const html = build(title, header, inner);

    let sent = 0;
    for (const r of recipients) {
      try { await sendEmail(r.email, subject, html); sent++; } catch { /* best-effort */ }
    }

    return json(200, { ok: true, sent });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
