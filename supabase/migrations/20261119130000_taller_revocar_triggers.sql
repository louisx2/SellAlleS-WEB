-- Las funciones de trigger del taller no se llaman por la API: solo las dispara la
-- base. Nacen con EXECUTE para PUBLIC (default de Postgres), y el linter avisa
-- porque son SECURITY DEFINER. Se revoca, como con el resto de triggers.
revoke execute on function public.taller_before_insert_service() from public, anon, authenticated;
revoke execute on function public.taller_before_update_service() from public, anon, authenticated;
revoke execute on function public.taller_before_delete_service() from public, anon, authenticated;
revoke execute on function public.taller_after_service_event() from public, anon, authenticated;
revoke execute on function public.taller_service_item_guard() from public, anon, authenticated;
revoke execute on function public.taller_service_item_totals() from public, anon, authenticated;
