-- Las empresas creadas desde /admin/empresas nacian con trial_ends_at en null,
-- asi que su prueba no vencia nunca y jamas entraban en solo-lectura. Solo el
-- registro por el landing ponia fecha.
--
-- Se resuelve con un trigger y no en el formulario, para que cubra TODOS los
-- caminos de alta a la vez: el panel, el landing, un script, o lo que venga
-- despues. Si quien inserta ya trae una fecha, se respeta: el super admin puede
-- fijar la que quiera desde el panel.

create or replace function public.companies_prueba_por_defecto()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare v_dias integer;
begin
  -- Solo aplica a empresas que nacen en prueba y sin fecha propia. Las demo
  -- tienen su propio vencimiento (demo_expires_at) y no entran aqui.
  if new.trial_ends_at is null
     and new.status::text = 'trial'
     and coalesce(new.is_demo, false) = false then
    select coalesce(trial_days, 28) into v_dias from public.platform_settings limit 1;
    new.trial_ends_at := now() + make_interval(days => coalesce(v_dias, 28));
  end if;
  return new;
end;
$$;

create trigger companies_prueba_por_defecto
  before insert on public.companies
  for each row execute function public.companies_prueba_por_defecto();

revoke all on function public.companies_prueba_por_defecto() from public, anon, authenticated;
