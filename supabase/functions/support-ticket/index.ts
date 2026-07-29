// Acciones sobre tickets de soporte que requieren privilegios (escribir en las
// tablas, que están cerradas a RLS, y enviar correo con la API key de Resend):
//   create     → cualquier usuario autenticado abre una solicitud desde la app
//   reply      → solo super admin: responde por correo y guarda el mensaje
//   set_status → solo super admin
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Plantilla mínima y sobria, en la línea del recibo de venta que ya existe. */
function wrap(title: string, bodyHtml: string, footer: string) {
  return `
    <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
      <h2 style="color: #4F46E5; border-bottom: 2px solid #F3F4F6; padding-bottom: 10px;">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="font-size: 12px; color: #9CA3AF; margin-top: 30px;">${footer}</p>
    </div>`;
}

interface SendArgs {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Devuelve el id del correo en Resend, que se guarda en support_messages. */
async function sendEmail(apiKey: string, args: SendArgs): Promise<string | null> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Resend API Error: ${resp.status} ${detail}`);
  }
  const body = await resp.json().catch(() => null);
  return body?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return json(401, { error: 'Sesión inválida.' });

    const { data: profile } = await admin
      .from('profiles')
      .select('id, name, email, company_id, is_super_admin')
      .eq('id', caller.user.id)
      .single();
    if (!profile) return json(403, { error: 'Perfil no encontrado.' });

    const isSuper = profile.is_super_admin === true;
    const body = await req.json().catch(() => null);
    const action = body?.action;

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json(500, { error: 'Falta RESEND_API_KEY.' });

    // Los datos de contacto salen de la configuración de plataforma, no de
    // constantes: si cambia el correo de soporte, cambian también los envíos.
    const { data: settings } = await admin
      .from('platform_settings')
      .select('support_email')
      .maybeSingle();
    const supportEmail: string = settings?.support_email ?? 'soporte@sellalles.com';

    // Solo se puede enviar DESDE un dominio verificado en Resend. Si el super
    // admin pone un correo de soporte externo (un Gmail, por ejemplo), se envía
    // desde la dirección verificada y ese correo va en Reply-To.
    const verifiedFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'SellAlleS <soporte@sellalles.com>';
    const canSendAsSupport = supportEmail.toLowerCase().endsWith('@sellalles.com');
    const from = canSendAsSupport ? `Soporte SellAlleS <${supportEmail}>` : verifiedFrom;
    const replyTo = canSendAsSupport ? undefined : supportEmail;

    // ── create ─────────────────────────────────────────────────────────────
    if (action === 'create') {
      const subject = String(body?.subject ?? '').trim();
      const message = String(body?.message ?? '').trim();
      if (!subject || !message) return json(400, { error: 'Asunto y mensaje son obligatorios.' });

      const contactEmail = profile.email ?? caller.user.email;
      if (!contactEmail) return json(400, { error: 'Tu usuario no tiene correo para responderte.' });

      // Contexto útil para atender sin ir y venir preguntando: se guarda en el
      // mensaje, no se le muestra como si lo hubiera escrito el usuario.
      const context = String(body?.context ?? '').trim();

      const { data: ticket, error: ticketErr } = await admin
        .from('support_tickets')
        .insert({
          company_id: profile.company_id ?? null,
          created_by: profile.id,
          contact_email: contactEmail,
          contact_name: profile.name ?? null,
          subject,
          source: 'app',
        })
        .select('id, code')
        .single();
      if (ticketErr || !ticket) throw new Error(ticketErr?.message ?? 'No se pudo crear el ticket.');

      const fullText = context ? `${message}\n\n---\n${context}` : message;
      const { error: msgErr } = await admin.from('support_messages').insert({
        ticket_id: ticket.id,
        direction: 'inbound',
        from_email: contactEmail,
        body_text: fullText,
      });
      if (msgErr) throw new Error(msgErr.message);

      // Acuse de recibo. Si el correo falla, el ticket YA está creado: se
      // reporta el fallo pero no se pierde la solicitud.
      let emailWarning: string | null = null;
      try {
        await sendEmail(apiKey, {
          from,
          replyTo,
          to: contactEmail,
          subject: `Recibimos tu solicitud [${ticket.code}]`,
          text:
            `Hola${profile.name ? ` ${profile.name}` : ''},\n\n` +
            `Recibimos tu solicitud de soporte y ya está en nuestra cola.\n\n` +
            `Referencia: ${ticket.code}\nAsunto: ${subject}\n\n` +
            `Tu mensaje:\n${message}\n\n` +
            `Puedes responder este correo para agregar información.\n\nEquipo SellAlleS`,
          html: wrap(
            'Recibimos tu solicitud',
            `<p>Hola${profile.name ? ` ${escapeHtml(profile.name)}` : ''},</p>
             <p>Recibimos tu solicitud de soporte y ya está en nuestra cola.</p>
             <div style="background-color: #F9FAFB; padding: 15px; border-radius: 5px; margin: 20px 0;">
               <p style="margin:0 0 8px 0;"><strong>Referencia:</strong> ${escapeHtml(ticket.code)}</p>
               <p style="margin:0;"><strong>Asunto:</strong> ${escapeHtml(subject)}</p>
             </div>
             <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
             <p>Puedes responder este correo para agregar información.</p>`,
            'Conserva la referencia entre corchetes en el asunto: es lo que mantiene unido el hilo.',
          ),
        });
      } catch (e) {
        emailWarning = e instanceof Error ? e.message : String(e);
        console.error('Ticket creado pero falló el acuse de recibo:', emailWarning);
      }

      return json(200, { ok: true, ticketId: ticket.id, code: ticket.code, emailWarning });
    }

    // ── reply ──────────────────────────────────────────────────────────────
    if (action === 'reply') {
      if (!isSuper) return json(403, { error: 'Solo el administrador de la plataforma puede responder.' });

      const ticketId = body?.ticketId;
      const message = String(body?.message ?? '').trim();
      if (!ticketId || !message) return json(400, { error: 'Se requiere ticketId y mensaje.' });

      const { data: ticket } = await admin
        .from('support_tickets')
        .select('id, code, subject, contact_email, contact_name')
        .eq('id', ticketId)
        .maybeSingle();
      if (!ticket) return json(404, { error: 'Ticket no encontrado.' });

      // El código en el asunto es lo que permite enhebrar la respuesta del
      // cliente de vuelta a este mismo ticket (lo lee support-inbound).
      const resendId = await sendEmail(apiKey, {
        from,
        replyTo,
        to: ticket.contact_email,
        subject: `Re: ${ticket.subject} [${ticket.code}]`,
        text:
          `Hola${ticket.contact_name ? ` ${ticket.contact_name}` : ''},\n\n${message}\n\n` +
          `Equipo SellAlleS\nReferencia: ${ticket.code}`,
        html: wrap(
          'Respuesta de soporte',
          `<p>Hola${ticket.contact_name ? ` ${escapeHtml(ticket.contact_name)}` : ''},</p>
           <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>`,
          `Referencia ${escapeHtml(ticket.code)} — responde este correo si necesitas algo más.`,
        ),
      });

      const { error: msgErr } = await admin.from('support_messages').insert({
        ticket_id: ticket.id,
        direction: 'outbound',
        author_profile_id: profile.id,
        from_email: supportEmail,
        body_text: message,
        resend_email_id: resendId,
      });
      if (msgErr) throw new Error(msgErr.message);

      // Contestado: queda a la espera del cliente, no cerrado.
      await admin
        .from('support_tickets')
        .update({ status: 'pending', closed_at: null })
        .eq('id', ticket.id);

      return json(200, { ok: true, resendId });
    }

    // ── set_status ─────────────────────────────────────────────────────────
    if (action === 'set_status') {
      if (!isSuper) return json(403, { error: 'Solo el administrador de la plataforma puede cambiar el estado.' });

      const ticketId = body?.ticketId;
      const status = body?.status;
      if (!ticketId || !['open', 'pending', 'closed'].includes(status)) {
        return json(400, { error: 'Estado inválido.' });
      }

      const { error } = await admin
        .from('support_tickets')
        .update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null })
        .eq('id', ticketId);
      if (error) throw new Error(error.message);

      return json(200, { ok: true });
    }

    return json(400, { error: 'Acción no reconocida.' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('support-ticket:', msg);
    return json(500, { error: msg });
  }
});
