// Resuelve el enlace corto de un comprobante y redirige a la descarga. También
// resuelve el enlace de seguimiento de un caso del taller (código de 10
// caracteres) y redirige a su página pública en la app.
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

/** Página pública de seguimiento de un caso del taller (en la app, porque una
 *  Edge Function no puede servir HTML: Supabase lo reescribe a text/plain). */
const APP_BASE = Deno.env.get('APP_BASE_URL') ?? 'https://app.sellalles.com';

/** Los códigos de seguimiento del taller tienen 10 caracteres; los de los
 *  comprobantes, 8. Mismo alfabeto, sin caracteres que se confunden. */
const CODIGO_TALLER = /^[23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/;

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
      // ¿Es el enlace de seguimiento de un caso del taller? Mismo formato que el
      // de las facturas (sellalles.com/<empresa>/c/<código>), así el cliente ve
      // el nombre del negocio. La página vive en la app; aquí solo se redirige.
      if (CODIGO_TALLER.test(code)) {
        const { data: caso } = await admin
          .from('services')
          .select('id')
          .eq('tracking_code', code)
          .maybeSingle();
        if (caso) {
          return new Response(null, {
            status: 302,
            headers: { Location: `${APP_BASE}/seguimiento?c=${encodeURIComponent(code)}` },
          });
        }
      }
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
