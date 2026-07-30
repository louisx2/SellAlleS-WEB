// DESACTIVADA. Esta funcion existio una sola vez, para copiar la
// SUPABASE_SERVICE_ROLE_KEY del entorno del runtime hacia Vault sin que la clave
// tuviera que pegarse a mano. Ya cumplio su proposito (vault.secrets contiene
// 'service_role_key') y su cuerpo se vacio para que no quede un endpoint capaz
// de tocar secretos.
//
// Se puede borrar desde el panel de Supabase: Edge Functions > bootstrap-vault.
Deno.serve(() =>
  new Response(JSON.stringify({ error: 'Funcion retirada.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
);
