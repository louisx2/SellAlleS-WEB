// Manda por correo el comprobante de un prestamo, con el PDF adjunto.
//
// Hermana de send-sale-receipt y deliberadamente aparte: el cuerpo del correo
// no se parece en nada. A un prestamo no se le dice "gracias por su compra" ni
// lleva NCF; lo que el cliente necesita leer es cuanto le prestaron, de a cuanto
// es la cuota y cuando vence la proxima.
//
// Como en el resto de supabase/functions, la funcion es autocontenida: se
// repiten los ayudantes de CORS y de Resend en vez de compartir un modulo. Es
// una decision del proyecto — cada funcion se despliega sola y se lee entera.
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

const FRECUENCIA: Record<string, string> = {
  weekly: 'semanal',
  biweekly: 'quincenal',
  monthly: 'mensual',
};

function money(n: number) {
  return `RD$ ${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fecha(d: string) {
  // Las cuotas son 'yyyy-mm-dd': sin hora explicita, el navegador las lee como
  // UTC y en RD (UTC-4) retroceden un dia.
  return new Date(`${d}T00:00:00`).toLocaleDateString('es-DO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

async function sendEmailWithAttachment(to: string, subject: string, html: string, pdfBase64: string, filename: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Falta la variable de entorno RESEND_API_KEY.');
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
      attachments: [{ content: pdfBase64, filename }],
    }),
  });

  if (!resp.ok) {
    const errText = (await resp.text().catch(() => '')).slice(0, 300);
    // El comprobante del prestamo lleva el cronograma completo, asi que pesa
    // mas que una factura y un plan de 60 cuotas puede pasarse del limite de la
    // peticion. Sin este dato, un fallo por tamano se ve igual que uno de
    // credenciales.
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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json(401, { error: 'Sesión inválida.' });

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_super_admin, company_id')
      .eq('id', callerData.user.id)
      .single();
    if (!callerProfile) return json(403, { error: 'Perfil no encontrado.' });

    const body = await req.json().catch(() => null);
    const loanId = body?.loanId;
    const email = body?.email;
    const pdfBase64 = body?.pdfBase64;
    const filename = body?.filename || `comprobante_prestamo_${loanId}.pdf`;

    if (!loanId || !email || !pdfBase64) {
      return json(400, { error: 'Solicitud inválida. Se requiere loanId, email y pdfBase64.' });
    }

    const { data: loan, error: loanErr } = await admin
      .from('loans')
      .select('id, company_id, branch_id, principal, total_with_interest, interest_rate, installments_count, payment_frequency, created_at')
      .eq('id', loanId)
      .single();

    if (loanErr || !loan) return json(404, { error: 'Préstamo no encontrado.' });

    const isSuper = callerProfile.is_super_admin === true;
    if (!isSuper && callerProfile.company_id !== loan.company_id) {
      return json(403, { error: 'No tienes permiso para acceder a este préstamo.' });
    }

    // Primera cuota y monto: es lo que el cliente va a buscar en el correo.
    const { data: primera } = await admin
      .from('loan_installments')
      .select('amount, due_date')
      .eq('loan_id', loan.id)
      .order('installment_number', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: company } = await admin
      .from('companies')
      .select('name')
      .eq('id', loan.company_id)
      .single();

    // El nombre comercial de la sucursal, si lo tiene: el cliente reconoce el
    // sitio donde fue, no la razon social.
    const { data: branch } = loan.branch_id
      ? await admin
          .from('branches')
          .select('name, display_name')
          .eq('id', loan.branch_id)
          .maybeSingle()
      : { data: null };

    const companyName = company?.name ?? 'SellAlleS';
    const branchName = branch?.display_name || branch?.name || null;
    const lugar = branchName ? `${companyName} — ${branchName}` : companyName;
    const frecuencia = FRECUENCIA[loan.payment_frequency] ?? 'mensual';
    const fechaPrestamo = new Date(loan.created_at).toLocaleDateString('es-DO', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const emailSubject = `Comprobante de préstamo - ${companyName}`;
    const emailHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2 style="color: #4F46E5; border-bottom: 2px solid #F3F4F6; padding-bottom: 10px;">Comprobante de Préstamo</h2>
        <p>Estimado(a) cliente,</p>
        <p>Le hacemos entrega del comprobante de su préstamo con <strong>${lugar}</strong>, en fecha ${fechaPrestamo}. En el archivo adjunto encontrará el detalle completo con el calendario de todas sus cuotas.</p>
        <div style="background-color: #F9FAFB; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 5px 0; font-weight: bold;">Monto prestado:</td><td style="padding: 5px 0;">${money(loan.principal)}</td></tr>
            <tr><td style="padding: 5px 0; font-weight: bold;">Total a pagar:</td><td style="padding: 5px 0;">${money(loan.total_with_interest)}</td></tr>
            <tr><td style="padding: 5px 0; font-weight: bold;">Plan:</td><td style="padding: 5px 0;">${loan.installments_count} cuotas (${frecuencia})</td></tr>
            ${primera ? `<tr><td style="padding: 5px 0; font-weight: bold;">Cuota:</td><td style="padding: 5px 0; color: #4F46E5; font-weight: bold;">${money(primera.amount)}</td></tr>` : ''}
            ${primera ? `<tr><td style="padding: 5px 0; font-weight: bold;">Primer vencimiento:</td><td style="padding: 5px 0;">${fecha(primera.due_date)}</td></tr>` : ''}
          </table>
        </div>
        <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin-top: 30px;">
          Este correo fue enviado de forma automática por la plataforma SellAlleS. Por favor no responda directamente a este mensaje.
        </p>
      </div>
    `;

    await sendEmailWithAttachment(email, emailSubject, emailHtml, pdfBase64, filename);

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { error: e?.message || String(e) });
  }
});
