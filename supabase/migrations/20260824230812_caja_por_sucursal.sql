-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.

-- El interruptor de Caja pasa a decidirse por sucursal.
--
-- Las cajas YA eran por sucursal: caja_sessions lleva branch_id y has_open_caja()
-- consulta por sucursal, asi que cada local abre y cierra la suya. Lo que era de
-- empresa era el INTERRUPTOR: encender el modulo obligaba a TODAS las sucursales
-- a abrir caja antes de cobrar en efectivo.
--
-- Eso bloqueaba el caso real de Pujols Group: Delmas Principal llega del sistema
-- viejo con control de caja, mientras Rancho Arriba y Todo Para Iphone no la usan
-- y no pueden cambiar su rutina de un dia para otro.
--
-- Quedan dos niveles:
--   company_modules.caja  -> si la empresa VE el modulo
--   branches.caja_enabled -> si ESA sucursal exige caja abierta para cobrar
--
-- El default false es lo que protege a las sucursales que ya existen: aunque se
-- encienda el modulo para la empresa, siguen cobrando en efectivo como hasta hoy.

alter table public.branches
  add column if not exists caja_enabled boolean not null default false;

comment on column public.branches.caja_enabled is
  'Si esta sucursal exige caja abierta para cobrar en efectivo. Requiere ademas que el modulo caja este encendido en la empresa. false = cobra sin caja, que es como funcionaban todas antes de esta columna.';

-- Definer y con search_path fijo, igual que has_open_caja e is_module_enabled:
-- el trigger de venta no es definer y no puede depender de que RLS deje leer la
-- sucursal desde donde se llame.
create or replace function public.branch_uses_caja(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select caja_enabled from branches where id = p_branch_id), false);
$function$;

revoke all on function public.branch_uses_caja(uuid) from public, anon;
grant execute on function public.branch_uses_caja(uuid) to authenticated;

create or replace function public.fn_require_open_caja_for_cash_sale()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not is_module_enabled(new.company_id, 'caja', false) then
    return new;
  end if;

  if not ((new.payment_method = 'cash')
          or (new.payment_status in ('credit','in_financing')
              and coalesce(new.amount_paid, 0) > 0
              and coalesce(new.down_payment_method, 'cash') = 'cash')) then
    return new;
  end if;

  -- Sin sucursal no hay caja que comprobar, y es un cobro en efectivo en una
  -- empresa que usa caja: se rechaza, igual que antes de esta migracion.
  if new.branch_id is null then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  -- La novedad: la sucursal puede no usar caja aunque la empresa si.
  if not public.branch_uses_caja(new.branch_id) then
    return new;
  end if;

  if not has_open_caja(new.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  return new;
end;
$function$;
