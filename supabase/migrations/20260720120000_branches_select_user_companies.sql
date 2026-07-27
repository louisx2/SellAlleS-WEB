-- Mis Empresas: las sucursales de todas las empresas del usuario deben ser
-- legibles sin necesidad de "entrar" (cambiar profiles.company_id) primero.
-- profile_companies es la fuente de verdad de membresía.

create or replace function public.user_company_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select company_id from public.profile_companies where profile_id = auth.uid()
$$;

drop policy branches_select on public.branches;
create policy branches_select on public.branches for select
  using (
    company_id = current_company_id()
    or company_id in (select public.user_company_ids())
    or is_super_admin()
  );
