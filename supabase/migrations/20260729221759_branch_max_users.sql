-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Tope de usuarios por sucursal, además del tope de la empresa. Los super
-- admins de la plataforma no cuentan contra el cupo.

alter table public.branches add column max_users int;

comment on column public.branches.max_users is
  'Tope de usuarios asignados a esta sucursal. null = sin límite. Se aplica además de companies.max_users.';

alter table public.branches
  add constraint branches_max_users_positivo
  check (max_users is null or max_users >= 1);

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
     and (p_exclude_profile is null or ocupantes.id <> p_exclude_profile);
$function$;

revoke all on function public.branch_user_count(uuid, uuid) from public, anon;
grant execute on function public.branch_user_count(uuid, uuid) to authenticated;

create or replace function public.check_branch_user_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
  v_profile uuid;
  v_es_super boolean;
  v_max int;
  v_nombre text;
  v_actual int;
begin
  if TG_TABLE_NAME = 'profile_branches' then
    v_branch := NEW.branch_id;
    v_profile := NEW.profile_id;
    select is_super_admin into v_es_super from public.profiles where id = v_profile;
  else
    v_branch := NEW.branch_id;
    v_profile := NEW.id;
    v_es_super := NEW.is_super_admin;
  end if;

  if v_branch is null then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'profiles' and TG_OP = 'UPDATE'
     and OLD.branch_id is not distinct from NEW.branch_id then
    return NEW;
  end if;

  if v_es_super then
    return NEW;
  end if;

  select max_users, name into v_max, v_nombre
    from public.branches where id = v_branch;

  if v_max is null then
    return NEW;
  end if;

  v_actual := public.branch_user_count(v_branch, v_profile);

  if v_actual >= v_max then
    raise exception
      'Límite de usuarios de la sucursal "%" alcanzado (% de %). No se pueden asignar más usuarios a esta sucursal.',
      v_nombre, v_actual, v_max;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_check_branch_user_limit_pb on public.profile_branches;
create trigger trg_check_branch_user_limit_pb
before insert on public.profile_branches
for each row execute function public.check_branch_user_limit();

drop trigger if exists trg_check_branch_user_limit_profiles on public.profiles;
create trigger trg_check_branch_user_limit_profiles
before insert or update of branch_id on public.profiles
for each row execute function public.check_branch_user_limit();

create or replace function public.company_branch_user_counts(p_company_id uuid)
returns table (branch_id uuid, user_count int)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not (
    public.is_platform_super_admin()
    or p_company_id in (select public.user_company_ids())
  ) then
    raise exception 'Sin permiso para consultar los usuarios de esta empresa.';
  end if;

  return query
    select b.id, public.branch_user_count(b.id, null)
      from public.branches b
     where b.company_id = p_company_id;
end;
$function$;

revoke all on function public.company_branch_user_counts(uuid) from public, anon;
grant execute on function public.company_branch_user_counts(uuid) to authenticated;
