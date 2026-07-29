// Borra del bucket los comprobantes que ya no sirve ningun enlace vigente.
//
// El enlace que va por WhatsApp muere a los 15 dias, pero el PDF se quedaba en
// Storage para siempre. Quitar la fila de storage.objects a mano no vale: deja
// el fichero colgado en el almacenamiento y se sigue pagando. Hay que pasar por
// la API de Storage, y por eso esto es una funcion y no solo SQL.
//
// Quien decide QUE sobra es public.limpiar_comprobantes(), que ademas purga los
// enlaces vencidos hace mas de un mes. Aqui solo se ejecuta el borrado.
//
// La dispara pg_cron una vez al dia. Es idempotente y solo toca lo que ya
// vencio, asi que correrla de mas no rompe nada.
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Storage acepta rutas de a lotes; no se le mandan miles de golpe. */
const LOTE = 100;

Deno.serve(async () => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await admin.rpc('limpiar_comprobantes');
    if (error) {
      console.error('limpiar-comprobantes: fallo la consulta:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rutas = (data ?? []).map((r: { ruta: string }) => r.ruta).filter(Boolean);
    if (rutas.length === 0) {
      console.log('limpiar-comprobantes: nada que borrar');
      return new Response(JSON.stringify({ ok: true, borrados: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let borrados = 0;
    const fallos: string[] = [];

    for (let i = 0; i < rutas.length; i += LOTE) {
      const lote = rutas.slice(i, i + LOTE);
      const { data: quitados, error: rmErr } = await admin.storage
        .from('comprobantes')
        .remove(lote);
      if (rmErr) {
        // Un lote que falla no aborta el resto: lo que quede sin borrar se
        // volvera a intentar manana, porque la consulta lo seguira listando.
        console.error('limpiar-comprobantes: fallo un lote:', rmErr.message);
        fallos.push(rmErr.message);
        continue;
      }
      borrados += quitados?.length ?? 0;
    }

    console.log(`limpiar-comprobantes: ${borrados} de ${rutas.length} borrados`);
    return new Response(JSON.stringify({ ok: true, borrados, candidatos: rutas.length, fallos }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('limpiar-comprobantes:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
