// Webhook de Resend para correos entrantes a soporte@sellalles.com.
// Convierte cada correo en un mensaje de un ticket de support_tickets.
//
// Es una función PÚBLICA (verify_jwt = false): Resend no manda un JWT de
// Supabase. La única puerta es la firma Svix del webhook, así que si falta o no
// cuadra, se rechaza sin tocar la base.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API = 'https://api.resend.com';

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Verificación de firma (esquema Svix, el que usa Resend) ─────────────────
// firma = base64( HMAC-SHA256( secreto, `${svix-id}.${svix-timestamp}.${body}` ) )
// El header svix-signature trae una lista separada por espacios de "v1,<firma>"
// porque puede haber varios secretos activos durante una rotación.
async function verifySvix(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  // Anti-replay: se rechaza lo que venga con más de 5 minutos de desfase.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Comparación en tiempo constante para no filtrar información por timing.
  const equals = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  return signatureHeader
    .split(' ')
    .map((part) => part.split(',')[1] ?? '')
    .some((sig) => sig && equals(sig, expected));
}

/** "Juan Pérez <juan@x.com>" → "juan@x.com". Devuelve minúsculas. */
function parseAddress(value: string | null | undefined): { email: string; name: string | null } {
  if (!value) return { email: '', name: null };
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return { email: match[2].trim().toLowerCase(), name: name || null };
  }
  return { email: value.trim().toLowerCase(), name: null };
}

/** El asunto de nuestras respuestas lleva [SA-00001]: es lo que enhebra la
 *  contestación del cliente con el ticket que ya existe. */
function extractTicketCode(subject: string): string | null {
  return subject.match(/\[(SA-\d{5,})\]/i)?.[1]?.toUpperCase() ?? null;
}

/** Limpia el asunto para usarlo como título del ticket. */
function cleanSubject(subject: string): string {
  const withoutCode = subject.replace(/\[SA-\d{5,}\]/gi, '').trim();
  const withoutRe = withoutCode.replace(/^((re|rv|fwd|fw)\s*:\s*)+/i, '').trim();
  return withoutRe || withoutCode || '(sin asunto)';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  // Leer correos recibidos exige una llave con acceso de lectura; la
  // RESEND_API_KEY que usan las demás funciones es de solo envío a propósito
  // (menos privilegio donde no hace falta). Por eso esta función tiene la suya,
  // con caída a la común por si algún día se unifican.
  const resendKey = Deno.env.get('RESEND_INBOUND_API_KEY') ?? Deno.env.get('RESEND_API_KEY');
  if (!webhookSecret || !resendKey) {
    console.error('Faltan RESEND_WEBHOOK_SECRET o RESEND_INBOUND_API_KEY.');
    return json(500, { error: 'Función mal configurada.' });
  }

  // El cuerpo crudo debe leerse tal cual: la firma cubre byte por byte.
  const rawBody = await req.text();
  if (!(await verifySvix(webhookSecret, req.headers, rawBody))) {
    return json(401, { error: 'Firma inválida.' });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'Cuerpo no es JSON.' });
  }

  // Otros eventos (bounces, entregas) no rompen nada: se aceptan y se ignoran,
  // para que Resend no los reintente eternamente.
  if (event.type !== 'email.received') return json(200, { ok: true, ignored: event.type ?? null });

  const data = event.data ?? {};
  const emailId = (data.email_id ?? data.id) as string | undefined;
  if (!emailId) return json(400, { error: 'Evento sin id de correo.' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Idempotencia: Resend reintenta los webhooks. Si ya guardamos este correo,
  // se responde 200 sin duplicar el mensaje.
  const { data: existing } = await admin
    .from('support_messages')
    .select('id')
    .eq('resend_email_id', emailId)
    .maybeSingle();
  if (existing) return json(200, { ok: true, duplicate: true });

  // El webhook no trae el cuerpo, solo metadatos: hay que pedirlo.
  const resp = await fetch(`${RESEND_API}/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${resendKey}` },
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300);
    console.error(`No se pudo leer el correo ${emailId}: ${resp.status} ${detail}`);
    // Se devuelve el status de Resend: un 401/403 significa que RESEND_API_KEY
    // es una llave de solo envío y no puede leer correos recibidos — eso hay
    // que verlo de inmediato, no adivinarlo. El endpoint ya está protegido por
    // la firma, así que no filtra nada a terceros.
    // 4xx no se reintenta (el problema es de configuración); 5xx sí.
    const retriable = resp.status >= 500;
    return json(retriable ? 500 : 502, {
      error: 'No se pudo leer el correo en Resend.',
      resendStatus: resp.status,
      resendDetail: detail,
    });
  }
  const mail = await resp.json();

  const { email: fromEmail, name: fromName } = parseAddress(mail.from);
  if (!fromEmail) return json(400, { error: 'Correo sin remitente.' });

  const rawSubject: string = mail.subject ?? '';
  const bodyText: string | null = mail.text ?? null;
  const bodyHtml: string | null = mail.html ?? null;

  // ¿El remitente es un usuario conocido? Si lo es, el ticket queda amarrado a
  // su empresa y su equipo puede verlo. Si no, queda huérfano y solo lo ve el
  // super admin — que es justo lo que se quiere con un prospecto.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, name, company_id')
    .ilike('email', fromEmail)
    .maybeSingle();

  // Hilo: primero por el marcador [SA-xxxxx] del asunto.
  const code = extractTicketCode(rawSubject);
  let ticketId: string | null = null;

  if (code) {
    const { data: found } = await admin
      .from('support_tickets')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (found) {
      ticketId = found.id;
      // Una respuesta del cliente reabre el ticket: no puede quedar cerrado con
      // algo sin contestar.
      await admin
        .from('support_tickets')
        .update({ status: 'open', closed_at: null })
        .eq('id', ticketId);
    }
  }

  if (!ticketId) {
    const { data: created, error: createErr } = await admin
      .from('support_tickets')
      .insert({
        company_id: profile?.company_id ?? null,
        created_by: profile?.id ?? null,
        contact_email: fromEmail,
        contact_name: fromName ?? profile?.name ?? null,
        subject: cleanSubject(rawSubject),
        source: 'email',
      })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('No se pudo crear el ticket:', createErr);
      return json(500, { error: 'No se pudo crear el ticket.' });
    }
    ticketId = created.id;
  }

  const { error: msgErr } = await admin.from('support_messages').insert({
    ticket_id: ticketId,
    direction: 'inbound',
    from_email: fromEmail,
    body_text: bodyText,
    body_html: bodyHtml,
    resend_email_id: emailId,
  });
  if (msgErr) {
    // Choque con el índice único = otro intento del mismo webhook ganó la
    // carrera. No es un error real.
    if ((msgErr as { code?: string }).code === '23505') return json(200, { ok: true, duplicate: true });
    console.error('No se pudo guardar el mensaje:', msgErr);
    return json(500, { error: 'No se pudo guardar el mensaje.' });
  }

  return json(200, { ok: true, ticketId });
});
