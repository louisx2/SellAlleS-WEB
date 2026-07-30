import { createClient } from 'jsr:@supabase/supabase-js@2';

// Corre 1 vez al día (pg_cron + pg_net). Busca cuotas de préstamos y de
// ventas a crédito/financiadas que vencen en los próximos 3 días o que ya
// están vencidas, y aún no recibieron aviso (reminder_sent_at is null).
// Idempotente: marcar reminder_sent_at evita reenviar el mismo aviso.

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

    const cutoff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let sent = 0;
    let failed = 0;

    // Cuotas de préstamos.
    const { data: loanRows } = await admin
      .from('loan_installments')
      .select('id, due_date, amount, loan_id, loans(customer_id, company_id, customers(name, email), companies(name))')
      .is('reminder_sent_at', null)
      .neq('status', 'paid')
      .lte('due_date', cutoff);

    for (const row of (loanRows ?? []) as any[]) {
      const email = row.loans?.customers?.email;
      if (!email) continue;
      try {
        const overdue = row.due_date < new Date().toISOString().slice(0, 10);
        await sendEmail(
          email,
          overdue ? 'Tienes una cuota atrasada' : 'Tu cuota está por vencer',
          `<p>Hola ${row.loans.customers.name},</p>` +
            `<p>Tu cuota de <strong>${formatCurrency(row.amount)}</strong> con ${row.loans.companies?.name ?? 'el negocio'} ` +
            `${overdue ? 'venció el' : 'vence el'} ${row.due_date}.</p>`,
        );
        await admin.from('loan_installments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', row.id);
        sent++;
      } catch {
        failed++;
      }
    }

    // Cuotas de ventas a crédito/financiadas.
    const { data: saleRows } = await admin
      .from('financing_installments')
      .select('id, due_date, amount, sale_id, sales(customer_id, company_id, customers(name, email), companies(name))')
      .is('reminder_sent_at', null)
      .neq('status', 'paid')
      .lte('due_date', cutoff);

    for (const row of (saleRows ?? []) as any[]) {
      const email = row.sales?.customers?.email;
      if (!email) continue;
      try {
        const overdue = row.due_date < new Date().toISOString().slice(0, 10);
        await sendEmail(
          email,
          overdue ? 'Tienes una cuota atrasada' : 'Tu cuota está por vencer',
          `<p>Hola ${row.sales.customers.name},</p>` +
            `<p>Tu cuota de <strong>${formatCurrency(row.amount)}</strong> con ${row.sales.companies?.name ?? 'el negocio'} ` +
            `${overdue ? 'venció el' : 'vence el'} ${row.due_date}.</p>`,
        );
        await admin.from('financing_installments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', row.id);
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
