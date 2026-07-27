// Entrega al navegador lo necesario para compartir el comprobante de una venta
// por WhatsApp: una URL firmada para SUBIR el PDF y otra para DESCARGARLO.
//
// El PDF no pasa por esta funcion. Antes llegaba en base64 dentro del JSON y la
// peticion fallaba por tamano ("Failed to send a request to the Edge
// Function"): un comprobante pesa mas de lo que admite ese cuerpo.
//
// Tampoco se le dan permisos de escritura al cliente sobre el bucket: sube con
// una URL firmada de un solo uso que se emite aqui, despues de comprobar que la
// venta es de su empresa. El bucket sigue privado y sin policies.
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

/** Dias que vive el enlace de descarga. Suficiente para que el cliente lo abra
 *  con calma, corto para que un reenvio no lo deje expuesto indefinidamente. */
const DIAS_VALIDEZ = 15;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Metodo no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return json(401, { error: 'Sesion invalida.' });

    const { data: perfil } = await admin
      .from('profiles')
      .select('is_super_admin, company_id')
      .eq('id', caller.user.id)
      .single();
    if (!perfil) return json(403, { error: 'Perfil no encontrado.' });

    const body = await req.json().catch(() => null);
    const saleId = body?.saleId;
    if (!saleId) return json(400, { error: 'Se requiere saleId.' });

    const { data: sale } = await admin
      .from('sales')
      .select('id, company_id, ncf')
      .eq('id', saleId)
      .maybeSingle();
    if (!sale) return json(404, { error: 'Venta no encontrada.' });
    if (perfil.is_super_admin !== true && perfil.company_id !== sale.company_id) {
      return json(403, { error: 'No tienes permiso para acceder a esta venta.' });
    }

    // Ruta por empresa: los archivos quedan separados y es evidente de quien es
    // cada uno si algun dia hay que limpiar.
    const ruta = `${sale.company_id}/${sale.id}.pdf`;

    const { data: subida, error: upErr } = await admin.storage
      .from('comprobantes')
      .createSignedUploadUrl(ruta, { upsert: true });
    if (upErr || !subida) {
      console.error('Fallo creando la URL de subida:', upErr?.message);
      return json(502, { error: `No se pudo preparar la subida: ${upErr?.message ?? 'desconocido'}` });
    }

    // Firmar la descarga antes de que el archivo exista es valido: la URL
    // simplemente no resuelve hasta que se sube, y para entonces ya se subio.
    const { data: firmada, error: signErr } = await admin.storage
      .from('comprobantes')
      .createSignedUrl(ruta, DIAS_VALIDEZ * 24 * 60 * 60, {
        download: `comprobante${sale.ncf ? `-${sale.ncf}` : ''}.pdf`,
      });
    if (signErr || !firmada?.signedUrl) {
      console.error('Fallo firmando la descarga:', signErr?.message);
      return json(502, { error: `No se pudo generar el enlace: ${signErr?.message ?? 'desconocido'}` });
    }

    return json(200, {
      ok: true,
      ruta,
      uploadToken: subida.token,
      url: firmada.signedUrl,
      diasValidez: DIAS_VALIDEZ,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('receipt-link:', msg);
    return json(500, { error: msg });
  }
});
