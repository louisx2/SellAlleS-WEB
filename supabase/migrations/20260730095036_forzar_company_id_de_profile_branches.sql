-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- El company_id de profile_branches no se acepta como venga: se deriva siempre
-- de la sucursal. Mandar uno ajeno era la vía para colar un usuario en otra
-- empresa. Primero se corrigen las filas ya torcidas, después el trigger cierra
-- la puerta.

update public.profile_branches pb
   set company_id = b.company_id
  from public.branches b
 where b.id = pb.branch_id
   and pb.company_id <> b.company_id;

create or replace function public.force_profile_branch_company()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  select company_id into NEW.company_id
    from public.branches where id = NEW.branch_id;
  if NEW.company_id is null then
    raise exception 'La sucursal indicada no existe.';
  end if;
  return NEW;
end;
$function$;

revoke all on function public.force_profile_branch_company() from public, anon, authenticated;

drop trigger if exists trg_force_profile_branch_company on public.profile_branches;
create trigger trg_force_profile_branch_company
before insert or update of branch_id, company_id on public.profile_branches
for each row execute function public.force_profile_branch_company();
