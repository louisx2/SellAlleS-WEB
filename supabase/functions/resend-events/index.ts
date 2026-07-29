// Webhook de eventos de entrega de Resend: rebotes y quejas de spam.
//
// Existe para proteger la reputación del dominio. Cada correo que rebota o que
// alguien marca como spam la deteriora, y cuando cae lo suficiente lo primero
// que deja de llegar son los correos de auth — o sea, clientes nuevos que no
// pueden confirmar su cuenta. Por eso, al primer rebote duro se marca la
// dirección y send-lifecycle-email deja de escribirle.
//
// Pública (verify_jwt = false): Resend no manda un JWT de Supabase. La puerta
// es la firma Svix, igual que en support-inbound.
import { createClient } from 'jsr:@supabase/supabase-js@2';

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifySvix(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  // Secreto propio: Resend genera uno distinto por webhook, así que este no
  // puede compartir el de support-inbound. Además, rotar uno no rompe el otro.
  const webhookSecret = Deno.env.get('RESEND_EVENTS_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('Falta RESEND_EVENTS_WEBHOOK_SECRET.');
    return json(500, { error: 'Función mal configurada.' });
  }

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

  const tipo = event.type ?? '';
  if (tipo !== 'email.bounced' && tipo !== 'email.complained') {
    // Entregas y aperturas no interesan aquí; se aceptan para que Resend no
    // los reintente.
    return json(200, { ok: true, ignored: tipo });
  }

  const data = event.data ?? {};
  const destinatarios = Array.isArray(data.to) ? (data.to as string[]) : [String(data.to ?? '')];
  const emailId = (data.email_id ?? data.id ?? null) as string | null;

  // Resend hereda la nomenclatura de SES: los tipos son Permanent, Transient y
  // Undetermined — NO "hard"/"soft". Solo Permanent significa que la dirección
  // no existe; Transient es pasajero (buzón lleno, servidor caído) y bloquear
  // por eso dejaría sin correos a alguien por un problema de un día.
  // Undetermined se trata como pasajero a propósito: ante la duda, no se
  // bloquea a un cliente que sí puede recibir.
  const bounce = (data.bounce ?? {}) as Record<string, unknown>;
  const tipoBounce = String(bounce.type ?? '').toLowerCase();
  const subTipo = String(bounce.subType ?? '').toLowerCase();
  const esDuro = tipo === 'email.complained' ||
    tipoBounce === 'permanent' ||
    subTipo === 'suppressed';   // ya en la lista de supresión de SES

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const ahora = new Date().toISOString();
  const nuevoEstado = tipo === 'email.complained' ? 'complained' : 'bounced';

  // Deja constancia en el registro de envíos aunque el destinatario no sea un
  // usuario de la plataforma.
  if (emailId) {
    await admin
      .from('platform_email_log')
      .update({ status: nuevoEstado })
      .eq('resend_email_id', emailId);
  }

  const marcados: string[] = [];
  if (esDuro) {
    for (const destino of destinatarios.filter(Boolean)) {
      const { data: filas } = await admin
        .from('profiles')
        .update({ email_bounced_at: ahora })
        .ilike('email', destino.trim().toLowerCase())
        .select('id');
      if (filas?.length) marcados.push(destino);
    }
  }

  console.log(`${tipo}: ${destinatarios.join(', ')} | duro=${esDuro} | perfiles marcados=${marcados.length}`);
  return json(200, { ok: true, tipo, duro: esDuro, marcados: marcados.length });
});
