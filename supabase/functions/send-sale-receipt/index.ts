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

async function sendEmailWithAttachment(to: string, subject: string, html: string, pdfBase64: string, filename: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Falta la variable de entorno RESEND_API_KEY.');
  // Antes caía a onboarding@resend.dev, un dominio que no es nuestro: Resend lo
  // rechaza siempre. Mejor decir qué falta que fingir que se puede enviar.
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (!from) throw new Error('Falta la variable de entorno RESEND_FROM_EMAIL.');

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      attachments: [
        {
          content: pdfBase64,
          filename: filename,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = (await resp.text().catch(() => '')).slice(0, 300);
    // El tamaño importa: el PDF viaja en base64 dentro del JSON, y un recibo
    // largo puede pasarse del límite de la petición. Sin este dato, un fallo
    // por tamaño se ve igual que uno de credenciales.
    const pesoMb = (pdfBase64.length / 1024 / 1024).toFixed(2);
    throw new Error(`Resend respondió ${resp.status}: ${errText} (adjunto ${pesoMb} MB en base64)`);
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

    // Validate user token
    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json(401, { error: 'Sesión inválida.' });

    // Fetch user profile and company
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_super_admin, company_id')
      .eq('id', callerData.user.id)
      .single();
    if (!callerProfile) return json(403, { error: 'Perfil no encontrado.' });

    // Parse request body
    const body = await req.json().catch(() => null);
    const saleId = body?.saleId;
    const email = body?.email;
    const pdfBase64 = body?.pdfBase64;
    const filename = body?.filename || `recibo_venta_${saleId}.pdf`;

    if (!saleId || !email || !pdfBase64) {
      return json(400, { error: 'Solicitud inválida. Se requiere saleId, email y pdfBase64.' });
    }

    // Fetch sale info to verify permission
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('id, company_id, total, ncf')
      .eq('id', saleId)
      .single();

    if (saleErr || !sale) {
      return json(404, { error: 'Venta no encontrada.' });
    }

    const isSuper = callerProfile.is_super_admin === true;
    if (!isSuper && callerProfile.company_id !== sale.company_id) {
      return json(403, { error: 'No tienes permiso para acceder a esta venta.' });
    }

    const { data: company } = await admin
      .from('companies')
      .select('name')
      .eq('id', sale.company_id)
      .single();

    const companyName = company?.name ?? 'SellAlleS';
    const emailSubject = `Comprobante de Compra${sale.ncf ? ` NCF ${sale.ncf}` : ''} - ${companyName}`;
    const emailHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2 style="color: #4F46E5; border-bottom: 2px solid #F3F4F6; padding-bottom: 10px;">Comprobante de Compra</h2>
        <p>Estimado(a) cliente,</p>
        <p>Le hacemos entrega del comprobante electrónico correspondiente a su compra en <strong>${companyName}</strong>.</p>
        <p>En el archivo adjunto de este correo encontrará su factura en formato PDF.</p>
        <div style="background-color: #F9FAFB; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${sale.ncf ? `<tr><td style="padding: 5px 0; font-weight: bold;">NCF:</td><td style="padding: 5px 0;">${sale.ncf}</td></tr>` : ''}
            <tr><td style="padding: 5px 0; font-weight: bold;">Total facturado:</td><td style="padding: 5px 0; color: #10B981; font-weight: bold;">RD$ ${Number(sale.total).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
          </table>
        </div>
        <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin-top: 30px;">
          Este correo fue enviado de forma automática por la plataforma SellAlleS. Por favor no responda directamente a este mensaje.
        </p>
      </div>
    `;

    // Send email via Resend with attachment
    await sendEmailWithAttachment(email, emailSubject, emailHtml, pdfBase64, filename);

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { error: e?.message || String(e) });
  }
});
