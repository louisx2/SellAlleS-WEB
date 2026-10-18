-- Higiene: los default privileges de Supabase dan EXECUTE a anon en funciones
-- nuevas; annul_sale es solo para usuarios autenticados (y de todos modos
-- valida empresa y rol adentro).
revoke execute on function public.annul_sale(uuid, text, text) from anon;
