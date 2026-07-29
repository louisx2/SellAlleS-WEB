// Resuelve el enlace corto de un comprobante y redirige a la descarga.
//
// Es la unica funcion del proyecto SIN verificacion de JWT, y tiene que serlo:
// la abre el cliente final desde WhatsApp, sin sesion ni cuenta. Lo que la
// protege es el codigo, que es aleatorio y no se puede adivinar (8 caracteres
// de un alfabeto de 56 = ~9.7e13 combinaciones), y que la tabla receipt_links no
// es accesible para nadie mas -- ni anon ni authenticated tienen permisos.
//
// La URL firmada se emite AQUI y dura 5 minutos: lo justo para que el navegador
// siga la redireccion. Antes el enlace de WhatsApp era la propia URL firmada de
// 15 dias, asi que quien lo reenviara repartia el comprobante sin control.
// Ahora el que vence es el codigo, y borrar la fila revoca el acceso.
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Minutos que vive la URL firmada a la que se redirige. */
const MINUTOS_FIRMA = 5;

/** Respuesta legible para el cliente final, que no es tecnico y no espera un
 *  JSON. Se ve en el navegador del telefono. */
function pagina(status: number, titulo: string, detalle: string) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a;padding:24px}
  .caja{max-width:26rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0;color:#475569;line-height:1.5}
</style></head>
<body><div class="caja"><h1>${titulo}</h1><p>${detalle}</p></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (req) => {
  try {
    // La URL puede llegar como /functions/v1/c/<codigo> o /c/<codigo>.
    const partes = new URL(req.url).pathname.split('/').filter(Boolean);
    const code = partes[partes.length - 1];
    if (!code || code === 'c') {
      return pagina(400, 'Enlace incompleto', 'Falta el código del comprobante.');
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: enlace } = await admin
      .from('receipt_links')
      .select('storage_path, download_name, expires_at')
      .eq('code', code)
      .maybeSingle();

    // Mismo mensaje para "no existe" y "vencio" seria mas hermetico, pero al
    // cliente hay que decirle cual de las dos es: si vencio, sabe que tiene que
    // pedirlo de nuevo; el codigo ya lo tiene, asi que no se filtra nada.
    if (!enlace) {
      return pagina(404, 'Enlace no encontrado', 'Verifica que copiaste el enlace completo, o pídele el comprobante de nuevo al negocio.');
    }
    if (new Date(enlace.expires_at) <= new Date()) {
      return pagina(410, 'Este enlace venció', 'Por seguridad los comprobantes solo se pueden descargar por tiempo limitado. Pídele al negocio que te lo envíe otra vez.');
    }

    const { data: firmada, error } = await admin.storage
      .from('comprobantes')
      .createSignedUrl(enlace.storage_path, MINUTOS_FIRMA * 60, {
        download: enlace.download_name,
      });

    if (error || !firmada?.signedUrl) {
      console.error('c: no se pudo firmar', enlace.storage_path, error?.message);
      return pagina(502, 'No se pudo abrir el comprobante', 'Vuelve a intentarlo en un momento.');
    }

    // 302 y no 301: la URL firmada cambia en cada visita, no se puede cachear.
    return new Response(null, { status: 302, headers: { Location: firmada.signedUrl } });
  } catch (e) {
    console.error('c:', e instanceof Error ? e.message : String(e));
    return pagina(500, 'Algo salió mal', 'Vuelve a intentarlo en un momento.');
  }
});
