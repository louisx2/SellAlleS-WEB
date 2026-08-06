-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Las funciones de trigger no se llaman desde la app: las invoca Postgres. Con
-- EXECUTE para authenticated quedaban expuestas por PostgREST, así que se
-- revoca el permiso a todos los roles de la API.

revoke all on function public.check_branch_user_limit() from public, anon, authenticated;
revoke all on function public.check_reactivation_limits() from public, anon, authenticated;
revoke all on function public.check_company_membership_limit() from public, anon, authenticated;
