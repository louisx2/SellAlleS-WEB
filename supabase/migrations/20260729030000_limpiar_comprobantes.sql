-- Los comprobantes compartidos por WhatsApp se acumulaban para siempre: el
-- enlace moria a los 15 dias pero el PDF se quedaba en el bucket. Con 3 PDFs y
-- 1 enlace vivo ya habia 2 huerfanos; con volumen real crece por venta.
--
-- Esta funcion decide QUE sobra. Borrar el archivo en si no se puede desde
-- aqui: quitar la fila de storage.objects deja el fichero colgado en el
-- almacenamiento y se sigue pagando. De eso se encarga la Edge Function
-- limpiar-comprobantes, que llama a esta y luego usa la API de Storage.
create or replace function public.limpiar_comprobantes()
returns table(ruta text)
language plpgsql
volatile
security definer
set search_path to public
as $$
begin
  -- Las filas vencidas se conservan 30 dias mas a proposito. La funcion `c`
  -- distingue "no existe" (404) de "vencio" (410), y al cliente que abre un
  -- enlace viejo le sirve mucho mas leer "este enlace vencio, pideselo al
  -- negocio" que "no encontrado". Pasado ese mes ya no aporta.
  delete from public.receipt_links
  where expires_at < now() - interval '30 days';

  -- El PDF, en cambio, se borra en cuanto no queda ningun enlace vigente que
  -- lo sirva: es lo que ocupa espacio.
  return query
  select o.name::text
  from storage.objects o
  where o.bucket_id = 'comprobantes'
    -- Margen de un dia. El navegador SUBE el PDF antes de que se cree su fila
    -- en receipt_links (son dos llamadas), asi que sin este colchon la limpieza
    -- podria llevarse un comprobante recien subido en esa rendija.
    and coalesce(o.updated_at, o.created_at) < now() - interval '1 day'
    and not exists (
      select 1 from public.receipt_links rl
      where rl.storage_path = o.name
        and rl.expires_at > now()
    );
end;
$$;

-- Solo la llama la Edge Function con service role. Ni anon ni authenticated
-- tienen nada que hacer aqui: la funcion es SECURITY DEFINER y lista rutas de
-- comprobantes de todas las empresas.
revoke all on function public.limpiar_comprobantes() from anon, authenticated, public;

comment on function public.limpiar_comprobantes() is
  'Purga enlaces vencidos hace mas de 30 dias y devuelve las rutas de los PDFs que ya no sirve ningun enlace vigente. La borra de Storage la hace la Edge Function limpiar-comprobantes.';
