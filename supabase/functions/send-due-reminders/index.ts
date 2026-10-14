import { createClient } from 'jsr:@supabase/supabase-js@2';

// Corre 1 vez al día (pg_cron + pg_net). Busca cuotas de préstamos y de
// ventas a crédito/financiadas que vencen en los próximos 3 días o que ya
// están vencidas, y aún no recibieron aviso (reminder_sent_at is null).
// Idempotente: marcar reminder_sent_at evita reenviar el mismo aviso.
//
// Qué está vencido y cuánta mora debe lo decide `pending_due_reminders` en la
// base: con la fecha del NEGOCIO (acá era UTC, y a las 8 PM en RD ya decía
// "venció" un día antes) y con la política congelada de cada contrato, que es
// la que de verdad va a cobrar la RPC de abonos.

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

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: rows, error } = await admin.rpc('pending_due_reminders', { p_days_ahead: 3 });
    if (error) return json(500, { error: error.message });

    let sent = 0;
    let failed = 0;

    for (const row of (rows ?? []) as any[]) {
      const overdue = !!row.is_overdue;
      const lateFee = Number(row.late_fee ?? 0);
      const amountDue = Number(row.amount_due ?? 0);
      const business = row.company_name ?? 'el negocio';

      // La mora es el número que hace que alguien pague: si hay, va en el
      // asunto y sumada al total, no escondida en el cuerpo.
      const subject = overdue
        ? lateFee > 0
          ? `Tienes una cuota atrasada (mora ${formatCurrency(lateFee)})`
          : 'Tienes una cuota atrasada'
        : 'Tu cuota está por vencer';

      const moraHtml =
        lateFee > 0
          ? `<p>Mora acumulada: <strong>${formatCurrency(lateFee)}</strong>.` +
            ` Total a pagar hoy: <strong>${formatCurrency(amountDue + lateFee)}</strong>.</p>`
          : '';

      try {
        await sendEmail(
          row.customer_email,
          subject,
          `<p>Hola ${row.customer_name},</p>` +
            `<p>Tu cuota de <strong>${formatCurrency(amountDue)}</strong> con ${business} ` +
            `${overdue ? 'venció el' : 'vence el'} ${row.due_date}.</p>` +
            moraHtml,
        );
        const table = row.kind === 'loan' ? 'loan_installments' : 'financing_installments';
        await admin.from(table)
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', row.installment_id);
        sent++;
      } catch {
        failed++;
      }
    }

    return json(200, { ok: true, sent, failed });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
