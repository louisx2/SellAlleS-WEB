-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Da marcha atrás al reparto de la migración anterior: el cupo de la sucursal
-- vuelve a ser un techo propio y la suma NO tiene que cuadrar con el de la
-- empresa. Además los usuarios inactivos dejan de ocupar cupo, y reactivar a
-- alguien vuelve a chequear los límites (empresa y sucursal).

drop trigger if exists trg_check_branch_allocation on public.branches;
drop trigger if exists trg_check_company_allocation on public.companies;
drop function if exists public.check_branch_allocation();
drop function if exists public.check_company_allocation();
drop function if exists public.company_allocated_users(uuid, uuid);

create or replace function public.branch_user_count(
  p_branch_id uuid,
  p_exclude_profile uuid default null
)
returns int
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::int
    from (
      select p.id
        from public.profiles p
       where p.branch_id = p_branch_id
      union
      select pb.profile_id
        from public.profile_branches pb
       where pb.branch_id = p_branch_id
    ) ocupantes
    join public.profiles perfil on perfil.id = ocupantes.id
   where perfil.is_super_admin is distinct from true
     and perfil.is_active
     and (p_exclude_profile is null or ocupantes.id <> p_exclude_profile);
$function$;

create or replace function public.check_company_membership_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_max int;
  v_current int;
begin
  select max_users into v_max from public.companies where id = NEW.company_id;
  if v_max is null then
    return NEW;
  end if;

  select count(*) into v_current
    from public.profile_companies pc
    join public.profiles p on p.id = pc.profile_id
   where pc.company_id = NEW.company_id
     and p.is_super_admin is distinct from true
     and p.is_active;

  if v_current >= v_max then
    raise exception 'Límite de usuarios alcanzado (% de %). No se pueden registrar más usuarios en esta empresa.', v_current, v_max;
  end if;
  return NEW;
end;
$function$;

create or replace function public.check_reactivation_limits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_max int;
  v_current int;
  v_nombre text;
begin
  if NEW.is_active is not true or OLD.is_active is true then
    return NEW;
  end if;
  if NEW.is_super_admin then
    return NEW;
  end if;

  for v_max, v_nombre, v_current in
    select c.max_users, c.name,
           (select count(*)
              from public.profile_companies pc2
              join public.profiles p2 on p2.id = pc2.profile_id
             where pc2.company_id = c.id
               and p2.is_super_admin is distinct from true
               and p2.is_active
               and p2.id <> NEW.id)
      from public.profile_companies pc
      join public.companies c on c.id = pc.company_id
     where pc.profile_id = NEW.id
       and c.max_users is not null
  loop
    if v_current >= v_max then
      raise exception
        'No se puede reactivar: la empresa "%" ya tiene sus % usuarios ocupados. Libera un cupo o amplía el límite.',
        v_nombre, v_max;
    end if;
  end loop;

  if NEW.branch_id is not null then
    select max_users, name into v_max, v_nombre
      from public.branches where id = NEW.branch_id;
    if v_max is not null
       and public.branch_user_count(NEW.branch_id, NEW.id) >= v_max then
      raise exception
        'No se puede reactivar: la sucursal "%" ya tiene sus % usuarios ocupados.',
        v_nombre, v_max;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_check_reactivation_limits on public.profiles;
create trigger trg_check_reactivation_limits
before update of is_active on public.profiles
for each row execute function public.check_reactivation_limits();

update public.companies set max_users = null where max_users >= 999999;

comment on column public.companies.max_users is
  'Usuarios que admite la empresa. null = sin límite. Lo pone el super admin a mano; el plan solo sugiere un valor al elegirlo.';

comment on column public.branches.max_users is
  'Usuarios que admite esta sucursal. null = sin límite. Es un techo propio de la sucursal: la suma de las sucursales NO tiene que cuadrar con el cupo de la empresa.';
