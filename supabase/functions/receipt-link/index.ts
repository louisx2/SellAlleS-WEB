// Sube el PDF de un comprobante a Storage y devuelve un enlace de descarga
// temporal, para compartirlo por WhatsApp.
//
// Por qué un enlace y no el archivo: WhatsApp Web no permite adjuntar un
// archivo desde un enlace `wa.me`, así que hasta ahora el flujo obligaba a
// descargar el PDF y adjuntarlo a mano. Con un enlace, el mensaje sale de una
// vez y el cliente descarga cuando quiera.
//
// El bucket es privado y la URL va firmada con vencimiento: una factura lleva
// nombre del cliente, artículos y NCF, y no debe quedar accesible para siempre
// a quien reenvíe el enlace.
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

/** Días que vive el enlace. Suficiente para que el cliente lo abra con calma,
 *  corto para que un reenvío no lo deje expuesto indefinidamente. */
const DIAS_VALIDEZ = 15;

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

    const { data: perfil } = await admin
      .from('profiles')
      .select('is_super_admin, company_id')
      .eq('id', caller.user.id)
      .single();
    if (!perfil) return json(403, { error: 'Perfil no encontrado.' });

    const body = await req.json().catch(() => null);
    const saleId = body?.saleId;
    const pdfBase64 = body?.pdfBase64;
    if (!saleId || !pdfBase64) return json(400, { error: 'Se requiere saleId y pdfBase64.' });

    // Misma comprobación que el envío por correo: nadie genera el enlace de una
    // venta de otra empresa.
    const { data: sale } = await admin
      .from('sales')
      .select('id, company_id, ncf')
      .eq('id', saleId)
      .maybeSingle();
    if (!sale) return json(404, { error: 'Venta no encontrada.' });
    if (perfil.is_super_admin !== true && perfil.company_id !== sale.company_id) {
      return json(403, { error: 'No tienes permiso para acceder a esta venta.' });
    }

    // base64 -> bytes. El PDF viene del navegador ya generado.
    let bytes: Uint8Array;
    try {
      const binario = atob(pdfBase64);
      bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    } catch {
      return json(400, { error: 'El PDF no es base64 válido.' });
    }

    // Ruta por empresa: mantiene los archivos separados y hace evidente a quién
    // pertenece cada uno si algún día hay que limpiar.
    const ruta = `${sale.company_id}/${sale.id}.pdf`;

    const { error: upErr } = await admin.storage
      .from('comprobantes')
      .upload(ruta, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      console.error('Fallo subiendo el comprobante:', upErr.message);
      return json(502, { error: `No se pudo guardar el PDF: ${upErr.message}` });
    }

    const { data: firmada, error: signErr } = await admin.storage
      .from('comprobantes')
      .createSignedUrl(ruta, DIAS_VALIDEZ * 24 * 60 * 60, {
        // Que el navegador lo descargue con nombre legible en vez de abrir un
        // visor con el uuid de la venta como título.
        download: `comprobante${sale.ncf ? `-${sale.ncf}` : ''}.pdf`,
      });
    if (signErr || !firmada?.signedUrl) {
      console.error('Fallo firmando la URL:', signErr?.message);
      return json(502, { error: 'No se pudo generar el enlace.' });
    }

    return json(200, { ok: true, url: firmada.signedUrl, diasValidez: DIAS_VALIDEZ });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('receipt-link:', msg);
    return json(500, { error: msg });
  }
});
