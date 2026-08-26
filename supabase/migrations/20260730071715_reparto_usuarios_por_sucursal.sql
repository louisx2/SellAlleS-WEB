-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- branches.max_users deja de ser un tope suelto y pasa a ser un reparto del
-- cupo de la empresa: la suma de las sucursales no puede pasar de
-- companies.max_users, ni por subir el de una sucursal ni por bajar el de la
-- empresa. Los dos triggers cierran las dos direcciones.

create or replace function public.company_allocated_users(
  p_company_id uuid,
  p_exclude_branch uuid default null
)
returns int
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(max_users), 0)::int
    from public.branches
   where company_id = p_company_id
     and max_users is not null
     and (p_exclude_branch is null or id <> p_exclude_branch);
$function$;

revoke all on function public.company_allocated_users(uuid, uuid) from public, anon;
grant execute on function public.company_allocated_users(uuid, uuid) to authenticated;

create or replace function public.check_branch_allocation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total int;
  v_otras int;
begin
  if NEW.max_users is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.max_users is not distinct from NEW.max_users then
    return NEW;
  end if;

  select max_users into v_total
    from public.companies where id = NEW.company_id;

  if v_total is null then
    return NEW;
  end if;

  v_otras := public.company_allocated_users(NEW.company_id, NEW.id);

  if v_otras + NEW.max_users > v_total then
    raise exception
      'El reparto se pasa del cupo de la empresa: tiene % usuario(s) en total y ya hay % repartido(s) en sus otras sucursales, así que a esta le quedan % disponible(s).',
      v_total, v_otras, greatest(v_total - v_otras, 0);
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_check_branch_allocation on public.branches;
create trigger trg_check_branch_allocation
before insert or update of max_users on public.branches
for each row execute function public.check_branch_allocation();

create or replace function public.check_company_allocation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_repartido int;
begin
  if NEW.max_users is null then
    return NEW;
  end if;

  if OLD.max_users is not distinct from NEW.max_users then
    return NEW;
  end if;

  v_repartido := public.company_allocated_users(NEW.id, null);

  if v_repartido > NEW.max_users then
    raise exception
      'No se puede dejar el cupo de la empresa en %: ya hay % usuario(s) repartido(s) entre sus sucursales. Baja primero el reparto de las sucursales.',
      NEW.max_users, v_repartido;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_check_company_allocation on public.companies;
create trigger trg_check_company_allocation
before update of max_users on public.companies
for each row execute function public.check_company_allocation();

comment on column public.branches.max_users is
  'Cuántos de los usuarios de la empresa (companies.max_users) usa esta sucursal. null = sin reparto propio. La suma por empresa no puede pasar de companies.max_users.';
