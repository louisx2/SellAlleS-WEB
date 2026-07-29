// Entrega al navegador lo necesario para compartir el comprobante de una venta
// por WhatsApp. Son DOS llamadas, y el orden importa:
//
//   1) paso 'subida' -> URL firmada para SUBIR el PDF a Storage.
//   2) el navegador sube el archivo directo a Storage.
//   3) paso 'enlace' -> el enlace corto que va en el mensaje.
//
// No se puede firmar la descarga en el mismo viaje que la subida: Storage
// exige que el objeto exista para firmarlo y responde 400 "Object not found"
// si todavia no esta. Se comprobo contra el proyecto: firmar una ruta
// inexistente falla, firmar la misma ruta despues de subir devuelve 200 y el
// enlace abre sin sesion.
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

/** Dominio del enlace que recibe el cliente. Va en el worker de la landing, que
 *  atiende /<empresa>/c/<codigo> y se lo pasa a la funcion `c`. Se puede mover
 *  de dominio sin invalidar lo ya enviado: lo que manda es el codigo. */
const BASE_ENLACE = Deno.env.get('RECEIPT_BASE_URL') ?? 'https://sellalles.com';

/** Sin los caracteres que se confunden al leerlos o dictarlos: 0/O, 1/l/I. */
const ALFABETO = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

/** 8 caracteres de 56 = ~9.6e13 combinaciones. El codigo es lo unico que
 *  protege el comprobante, asi que se saca del generador criptografico, no de
 *  Math.random(). */
function codigoNuevo() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

/** El nombre de la empresa en la URL es decorativo: le dice al cliente de quien
 *  es el comprobante antes de abrirlo. Se guarda tal como estaba al compartir,
 *  para que un cambio de nombre no rompa los enlaces ya enviados.
 *
 *  Tiene que dar el mismo resultado que `slugParaEnlace` en el navegador, que
 *  es la que le ensena al usuario como va a quedar antes de guardar. */
function slug(nombre: string | null | undefined) {
  const limpio = (nombre ?? '')
    .normalize('NFD')
    // Rango de las marcas diacriticas: separada la tilde por NFD, se descarta.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return limpio || 'comprobante';
}

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
    const paso = body?.paso === 'enlace' ? 'enlace' : 'subida';

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

    if (paso === 'subida') {
      // upsert para que reimprimir o reenviar el comprobante de la misma venta
      // sobrescriba el archivo en vez de fallar con "ya existe".
      const { data: subida, error: upErr } = await admin.storage
        .from('comprobantes')
        .createSignedUploadUrl(ruta, { upsert: true });
      if (upErr || !subida) {
        console.error('Fallo creando la URL de subida:', upErr?.message);
        return json(502, { error: `No se pudo preparar la subida: ${upErr?.message ?? 'desconocido'}` });
      }
      return json(200, { ok: true, ruta, uploadToken: subida.token });
    }

    // paso 'enlace': se guarda un codigo corto y se devuelve la direccion que
    // ve el cliente. Antes se devolvia la URL firmada de Storage, que mide 559
    // caracteres y apunta a un dominio que el cliente no reconoce: ilegible en
    // un mensaje y con pinta de estafa. Firmar la descarga es ahora tarea de la
    // funcion `c`, en el momento en que alguien abre el enlace.
    // link_slug es lo que la empresa configuro para verse en el enlace. Si no
    // configuro nada se deriva del nombre legal, que sirve pero rara vez es lo
    // que el negocio quiere ensenarle al cliente ("...-srl", "inventar-io").
    const { data: empresa } = await admin
      .from('companies')
      .select('name, link_slug')
      .eq('id', sale.company_id)
      .maybeSingle();

    // El nombre de descarga hace que al cliente le llegue "comprobante-B01...pdf"
    // y no el uuid de la venta.
    const nombreArchivo = `comprobante${sale.ncf ? `-${sale.ncf}` : ''}.pdf`;
    const empresaSlug = empresa?.link_slug?.trim() || slug(empresa?.name);
    const vence = new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000);

    // Si esta venta ya tiene un enlace vigente se reutiliza, para que reenviar
    // el comprobante no le cambie la direccion al cliente que ya la tiene.
    const { data: existente } = await admin
      .from('receipt_links')
      .select('code')
      .eq('sale_id', sale.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let code = existente?.code as string | undefined;

    if (!code) {
      // Reintentos por si el codigo aleatorio ya existe. Con 9.6e13
      // combinaciones no va a pasar, pero chocar y fallar seria peor que
      // volver a tirar el dado.
      for (let intento = 0; intento < 3 && !code; intento++) {
        const candidato = codigoNuevo();
        const { error: insErr } = await admin.from('receipt_links').insert({
          code: candidato,
          sale_id: sale.id,
          company_id: sale.company_id,
          company_slug: empresaSlug,
          storage_path: ruta,
          download_name: nombreArchivo,
          expires_at: vence.toISOString(),
          created_by: caller.user.id,
        });
        if (!insErr) code = candidato;
        else if (insErr.code !== '23505') {
          console.error('Fallo guardando el enlace corto:', insErr.message);
          return json(502, { error: `No se pudo generar el enlace: ${insErr.message}` });
        }
      }
    }

    if (!code) return json(502, { error: 'No se pudo generar el enlace. Intenta de nuevo.' });

    return json(200, {
      ok: true,
      ruta,
      url: `${BASE_ENLACE}/${empresaSlug}/c/${code}`,
      diasValidez: DIAS_VALIDEZ,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('receipt-link:', msg);
    return json(500, { error: msg });
  }
});
