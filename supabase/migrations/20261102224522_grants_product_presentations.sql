-- product_presentations nació confiando en el grant automático de Supabase:
-- 20261029120000_presentaciones solo le quita permisos a anon. Desde el
-- 30-oct-2026 lo nuevo en public ya no recibe ese grant, y en una base
-- reconstruida la tabla quedaría sin acceso: la lista de productos la embebe
-- en su select y save/import_product_presentations corren como el usuario.
-- En producción no cambia nada: ya tiene exactamente estos permisos.
grant select, insert, update, delete on public.product_presentations to authenticated;
grant select, insert, update, delete on public.product_presentations to service_role;
