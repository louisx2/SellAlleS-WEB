// Punto único de envío de los correos transaccionales de la PLATAFORMA
// (bienvenida, prueba por vencer, suspensión, activación, recibo de pago).
// No cubre los correos que una empresa manda a SUS clientes; esos siguen en
// send-sale-receipt y compañía.
//
// Todo pasa por aquí para que se cumplan tres cosas que antes no existían:
//   - un mismo aviso no se manda dos veces (clave única en platform_email_log)
//   - no se le escribe a direcciones que rebotaron
//   - se sabe cuántos correos van en el día, contra el tope del plan Free
//
// Las plantillas viven en este archivo y no en el editor de Resend a propósito:
// así quedan versionadas en git, se revisan en un diff y se despliegan junto
// con el código que las usa.
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

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

// El plan Free de Resend permite 100 correos al día. Se corta antes del tope
// para dejar aire a lo que no pasa por aquí (auth, recibos de venta): si el
// límite se agota, lo primero que deja de funcionar es la confirmación de
// cuenta de un cliente nuevo, y eso cuesta mucho más que un aviso de prueba.
const TOPE_DIARIO = 80;

type Template =
  | 'bienvenida'
  | 'prueba-por-vencer'
  | 'prueba-vencida'
  | 'cuenta-activada'
  | 'recibo-suscripcion'
  | 'cobro-por-vencer';

interface Contacto {
  whatsappEnabled: boolean;
  whatsappNumber: string | null;
  whatsappLabel: string | null;
  emailEnabled: boolean;
  email: string | null;
  hours: string | null;
}

function fmtFecha(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMoneda(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Bloque de contacto, siempre desde platform_settings: si el super admin
 *  cambia el número o apaga un canal, los correos lo reflejan sin redesplegar. */
function bloqueContacto(c: Contacto): string {
  const partes: string[] = [];
  if (c.whatsappEnabled && c.whatsappNumber) {
    // Sin el número a la vista: el enlace ya lleva al chat correcto, y mostrarlo
    // solo invita a guardarlo o marcarlo por fuera. Si cambia el número, los
    // correos viejos siguen funcionando porque el destino sale de la config.
    partes.push(
      `<a href="https://wa.me/${esc(c.whatsappNumber)}" style="display:inline-block;background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Contáctanos por WhatsApp</a>`,
    );
  }
  if (c.emailEnabled && c.email) {
    partes.push(`<a href="mailto:${esc(c.email)}" style="color:#4F46E5;">${esc(c.email)}</a>`);
  }
  if (!partes.length) return '';
  return `<div style="margin:24px 0;">${partes.join(' &nbsp; ')}${c.hours ? `<p style="font-size:12px;color:#6B7280;margin-top:8px;">${esc(c.hours)}</p>` : ''}</div>`;
}

function envolver(titulo: string, cuerpo: string, contacto: Contacto): string {
  return `
    <div style="font-family: sans-serif; color:#333; max-width:600px; margin:0 auto; padding:20px; border:1px solid #eee; border-radius:5px;">
      <h2 style="color:#4F46E5; border-bottom:2px solid #F3F4F6; padding-bottom:10px;">${esc(titulo)}</h2>
      ${cuerpo}
      ${bloqueContacto(contacto)}
      <p style="font-size:12px;color:#9CA3AF;margin-top:28px;">Este mensaje lo envía la plataforma SellAlleS.</p>
    </div>`;
}

interface Render { subject: string; html: string; text: string; }

function render(template: Template, vars: Record<string, unknown>, c: Contacto): Render {
  const empresa = esc(vars.companyName ?? 'tu empresa');
  const nombre = vars.userName ? ` ${esc(vars.userName)}` : '';

  switch (template) {
    case 'bienvenida':
      return {
        subject: `Bienvenido a SellAlleS, ${String(vars.companyName ?? '')}`.trim(),
        // Genérico a propósito: no todas las empresas tienen activados los
        // mismos módulos, así que prometer "facturar y cuadrar caja" podía
        // nombrar cosas que ese cliente no verá al entrar.
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nTu cuenta de ${vars.companyName ?? 'tu empresa'} ya está lista en SellAlleS.\n\n${vars.trialEndsAt ? `Tu prueba gratis va hasta el ${fmtFecha(vars.trialEndsAt)}.\n\n` : ''}Cualquier duda, escríbenos.\n\nEquipo SellAlleS`,
        html: envolver('Tu cuenta ya está lista', `
          <p>Hola${nombre},</p>
          <p>La cuenta de <strong>${empresa}</strong> quedó activa en SellAlleS y ya puedes empezar a usarla.</p>
          ${vars.trialEndsAt ? `<p>Tu prueba gratis va hasta el <strong>${esc(fmtFecha(vars.trialEndsAt))}</strong>.</p>` : ''}
          <p>Si necesitas ayuda para arrancar, estamos aquí:</p>`, c),
      };

    case 'prueba-por-vencer': {
      const dias = Number(vars.daysLeft ?? 0);
      // El barrido ya manda este correo el mismo día del corte, así que el 0
      // tiene que leerse: "en 0 días" no lo dice nadie.
      const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
      return {
        subject: `Tu prueba de SellAlleS termina ${cuando}`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa prueba gratis de ${vars.companyName ?? 'tu empresa'} termina ${cuando} (${fmtFecha(vars.trialEndsAt)}).\n\nCuando termine podrás seguir viendo tus datos, pero no registrar ni modificar nada hasta activar tu cuenta.\n\nEquipo SellAlleS`,
        html: envolver(`Tu prueba termina ${cuando}`, `
          <p>Hola${nombre},</p>
          <p>La prueba gratis de <strong>${empresa}</strong> termina <strong>${esc(cuando)}</strong>${vars.trialEndsAt ? ` (${esc(fmtFecha(vars.trialEndsAt))})` : ''}.</p>
          <p>Cuando termine vas a poder <strong>seguir viendo tus datos</strong>, pero no registrar ventas ni modificar nada hasta activar la cuenta. Nada se borra.</p>
          <p>Para activarla, escríbenos:</p>`, c),
      };
    }

    case 'prueba-vencida':
      return {
        subject: 'Tu prueba de SellAlleS terminó',
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa prueba gratis de ${vars.companyName ?? 'tu empresa'} terminó. Tus datos siguen ahí y puedes consultarlos, pero no registrar ni modificar hasta activar la cuenta.\n\nEquipo SellAlleS`,
        html: envolver('Tu prueba terminó', `
          <p>Hola${nombre},</p>
          <p>La prueba gratis de <strong>${empresa}</strong> llegó a su fin.</p>
          <p><strong>Tus datos siguen intactos.</strong> Puedes entrar y consultarlos cuando quieras; lo que queda bloqueado es registrar ventas y modificar información, hasta que actives la cuenta.</p>
          <p>Activarla toma un minuto:</p>`, c),
      };

    case 'cuenta-activada':
      return {
        subject: 'Tu cuenta de SellAlleS está activa',
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa cuenta de ${vars.companyName ?? 'tu empresa'} quedó activa.${vars.paidUntil ? ` Tu suscripción cubre hasta el ${fmtFecha(vars.paidUntil)}.` : ''}\n\nEquipo SellAlleS`,
        html: envolver('Cuenta activada', `
          <p>Hola${nombre},</p>
          <p>Listo: la cuenta de <strong>${empresa}</strong> quedó <strong>activa</strong> y ya puedes operar con normalidad.</p>
          ${vars.paidUntil ? `<p>Tu suscripción cubre hasta el <strong>${esc(fmtFecha(vars.paidUntil))}</strong>.</p>` : ''}
          <p>Gracias por confiar en SellAlleS.</p>`, c),
      };

    case 'cobro-por-vencer': {
      const dias = Number(vars.daysLeft ?? 0);
      const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
      return {
        subject: `Tu suscripción de SellAlleS vence ${cuando}`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa suscripción de ${vars.companyName ?? 'tu empresa'} vence ${cuando} (${fmtFecha(vars.paidUntil)}).\n\nPara renovarla, escríbenos y coordinamos la transferencia.\n\nEquipo SellAlleS`,
        html: envolver(`Tu suscripción vence ${cuando}`, `
          <p>Hola${nombre},</p>
          <p>La suscripción de <strong>${empresa}</strong> vence <strong>${esc(cuando)}</strong>${vars.paidUntil ? ` (${esc(fmtFecha(vars.paidUntil))})` : ''}.</p>
          <p>Si vence sin renovar, vas a <strong>seguir viendo tus datos</strong>, pero no podrás registrar ventas ni modificar información hasta ponerte al día. Nada se borra.</p>
          <p>Escríbenos y coordinamos la transferencia:</p>`, c),
      };
    }

    case 'recibo-suscripcion':
      return {
        subject: `Recibo de pago — SellAlleS${vars.paidUntil ? ` (hasta ${fmtFecha(vars.paidUntil)})` : ''}`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nRecibimos tu pago de ${fmtMoneda(vars.amount)} para ${vars.companyName ?? 'tu empresa'}.${vars.paidUntil ? ` Tu suscripción queda cubierta hasta el ${fmtFecha(vars.paidUntil)}.` : ''}\n\nEquipo SellAlleS`,
        html: envolver('Recibo de pago', `
          <p>Hola${nombre},</p>
          <p>Recibimos tu pago de suscripción para <strong>${empresa}</strong>.</p>
          <div style="background:#F9FAFB;padding:15px;border-radius:5px;margin:20px 0;">
            <p style="margin:0 0 8px 0;"><strong>Monto:</strong> ${esc(fmtMoneda(vars.amount))}</p>
            ${vars.method ? `<p style="margin:0 0 8px 0;"><strong>Método:</strong> ${esc(vars.method)}</p>` : ''}
            ${vars.paidAt ? `<p style="margin:0 0 8px 0;"><strong>Fecha:</strong> ${esc(fmtFecha(vars.paidAt))}</p>` : ''}
            ${vars.paidUntil ? `<p style="margin:0;"><strong>Cubre hasta:</strong> ${esc(fmtFecha(vars.paidUntil))}</p>` : ''}
          </div>`, c),
      };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
    });

    // Dos formas legítimas de llamar: el job programado con la service role
    // key, o un super admin desde el panel. Nadie más.
    const esSistema = token === serviceKey;
    if (!esSistema) {
      const { data: caller } = await admin.auth.getUser(token);
      if (!caller?.user) return json(401, { error: 'Sesión inválida.' });
      const { data: perfil } = await admin
        .from('profiles')
        .select('is_super_admin')
        .eq('id', caller.user.id)
        .single();
      if (!perfil?.is_super_admin) {
        return json(403, { error: 'Solo el administrador de la plataforma puede enviar estos correos.' });
      }
    }

    const body = await req.json().catch(() => null);
    const template = body?.template as Template | undefined;
    const to = String(body?.to ?? '').trim().toLowerCase();
    const companyId = body?.companyId ?? null;
    const vars = (body?.vars ?? {}) as Record<string, unknown>;
    const dedupeKey = String(body?.dedupeKey ?? '').trim();

    const validas: Template[] = [
      'bienvenida', 'prueba-por-vencer', 'prueba-vencida', 'cuenta-activada',
      'recibo-suscripcion', 'cobro-por-vencer',
    ];
    if (!template || !validas.includes(template)) return json(400, { error: 'Plantilla no reconocida.' });
    if (!to || !to.includes('@')) return json(400, { error: 'Destinatario inválido.' });
    if (!dedupeKey) return json(400, { error: 'Falta dedupeKey.' });

    // No insistirle a una dirección que ya rebotó: cada rebote extra empeora la
    // reputación del dominio y termina afectando hasta los correos de auth.
    const { data: rebotado } = await admin
      .from('profiles')
      .select('email_bounced_at')
      .ilike('email', to)
      .not('email_bounced_at', 'is', null)
      .maybeSingle();
    if (rebotado) return json(200, { ok: true, skipped: 'correo_rebotado' });

    // Tope diario del plan Free.
    const desdeMedianoche = new Date();
    desdeMedianoche.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from('platform_email_log')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('created_at', desdeMedianoche.toISOString());
    if ((count ?? 0) >= TOPE_DIARIO) {
      console.error(`Tope diario alcanzado (${count}/${TOPE_DIARIO}); no se envía ${template} a ${to}.`);
      return json(429, { error: 'Tope diario de correos alcanzado.', enviadosHoy: count });
    }

    // Se reserva la clave ANTES de enviar. Si dos procesos corren a la vez, uno
    // choca contra el índice único y no se manda el correo duplicado. Al revés
    // (enviar y después registrar) habría ventana para mandarlo dos veces.
    const { data: reserva, error: reservaErr } = await admin
      .from('platform_email_log')
      .insert({ company_id: companyId, template, to_email: to, dedupe_key: dedupeKey })
      .select('id')
      .single();
    if (reservaErr) {
      if ((reservaErr as { code?: string }).code === '23505') {
        return json(200, { ok: true, skipped: 'ya_enviado' });
      }
      throw new Error(reservaErr.message);
    }

    // Contacto vigente desde la configuración de plataforma.
    const { data: settings } = await admin
      .from('platform_settings')
      .select('support_whatsapp_enabled, support_whatsapp_number, support_whatsapp_label, support_email_enabled, support_email, support_hours')
      .maybeSingle();
    const contacto: Contacto = {
      whatsappEnabled: settings?.support_whatsapp_enabled ?? false,
      whatsappNumber: settings?.support_whatsapp_number ?? null,
      whatsappLabel: settings?.support_whatsapp_label ?? null,
      emailEnabled: settings?.support_email_enabled ?? false,
      email: settings?.support_email ?? null,
      hours: settings?.support_hours ?? null,
    };

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json(500, { error: 'Falta RESEND_API_KEY.' });
    const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'SellAlleS <soporte@sellalles.com>';

    const { subject, html, text } = render(template, vars, contacto);

    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          subject,
          html,
          text,
          ...(contacto.emailEnabled && contacto.email ? { reply_to: contacto.email } : {}),
        }),
      });
      if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
      const enviado = await resp.json().catch(() => null);

      await admin
        .from('platform_email_log')
        .update({ resend_email_id: enviado?.id ?? null })
        .eq('id', reserva.id);

      return json(200, { ok: true, resendId: enviado?.id ?? null });
    } catch (e) {
      // La reserva queda marcada como fallida. El índice único es parcial y no
      // cuenta los 'failed', así que un reintento posterior sí puede enviar.
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from('platform_email_log')
        .update({ status: 'failed', error: msg.slice(0, 500) })
        .eq('id', reserva.id);
      console.error(`Fallo enviando ${template} a ${to}: ${msg}`);
      return json(502, { error: 'No se pudo enviar el correo.', detalle: msg });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('send-lifecycle-email:', msg);
    return json(500, { error: msg });
  }
});
