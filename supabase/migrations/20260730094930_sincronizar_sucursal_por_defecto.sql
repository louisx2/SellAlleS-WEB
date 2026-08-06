-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- La sucursal por defecto del perfil también cuenta como asignación: si no
-- entra en profile_branches, el usuario aparece sin sucursales aunque tenga
-- una. Primero se rellenan las que faltaban, después el trigger las mantiene.

insert into public.profile_branches (profile_id, branch_id, company_id)
select p.id, p.branch_id, b.company_id
  from public.profiles p
  join public.branches b on b.id = p.branch_id
 where p.branch_id is not null
   and not exists (
     select 1 from public.profile_branches pb
      where pb.profile_id = p.id and pb.branch_id = p.branch_id
   );

create or replace function public.sync_default_branch_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  if NEW.branch_id is null then
    return NEW;
  end if;

  select company_id into v_company from public.branches where id = NEW.branch_id;
  if v_company is null then
    return NEW;
  end if;

  insert into public.profile_branches (profile_id, branch_id, company_id)
  values (NEW.id, NEW.branch_id, v_company)
  on conflict do nothing;

  return NEW;
end;
$function$;

revoke all on function public.sync_default_branch_assignment() from public, anon, authenticated;

drop trigger if exists trg_sync_default_branch_assignment on public.profiles;
create trigger trg_sync_default_branch_assignment
after insert or update of branch_id on public.profiles
for each row execute function public.sync_default_branch_assignment();
