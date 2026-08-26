-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Un usuario puede tener un rol distinto en cada sucursal. El trigger impide
-- asignarle un rol de otra empresa y, sin rol propio, lo trata como Cajero.

alter table public.profile_branches
  add column role_id uuid references public.roles(id) on delete set null;

comment on column public.profile_branches.role_id is
  'Rol que tiene este usuario EN esta sucursal. null = sin rol propio, se trata como Cajero. Debe pertenecer a la misma empresa que la sucursal.';

update public.profile_branches pb
   set role_id = (
     select r.id
       from public.roles r
      where r.company_id = pb.company_id
        and r.is_system
        and r.key = coalesce(
              (select pc.role::text from public.profile_companies pc
                where pc.profile_id = pb.profile_id and pc.company_id = pb.company_id),
              (select p.role::text from public.profiles p where p.id = pb.profile_id),
              'cashier')
      limit 1
   )
 where pb.role_id is null;

create or replace function public.force_profile_branch_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  select company_id into v_company from public.branches where id = NEW.branch_id;
  if v_company is null then
    return NEW;
  end if;

  if NEW.role_id is not null then
    if not exists (
      select 1 from public.roles
       where id = NEW.role_id and company_id = v_company
    ) then
      raise exception 'Ese rol no pertenece a la empresa de la sucursal.';
    end if;
    return NEW;
  end if;

  select id into NEW.role_id
    from public.roles
   where company_id = v_company and is_system and key = 'cashier'
   limit 1;

  return NEW;
end;
$function$;

revoke all on function public.force_profile_branch_role() from public, anon, authenticated;

drop trigger if exists trg_force_profile_branch_role on public.profile_branches;
create trigger trg_force_profile_branch_role
before insert or update of branch_id, role_id on public.profile_branches
for each row execute function public.force_profile_branch_role();
