-- Precio propio por sucursal.
--
-- Hasta ahora cada sucursal activa pagaba la tarifa del plan. Hay clientes con
-- precio acordado: las sucursales de Pujols Group pagan 1,950 al mes, no 2,300.
--
-- - branches.cuota_mensual: lo que paga esa sucursal al mes. Vacío = la tarifa
--   del plan. 0 = no se le cobra. Una sucursal nueva nace vacía (tarifa normal).
-- - Solo el super admin lo cambia (poner_cuota_de_sucursal; el trigger revierte
--   cualquier otro cambio, porque branches la puede editar el admin de la
--   empresa).
-- - Rige para todas sus cuotas, también las ya vencidas: la cuenta no guarda
--   historial de precios (así se acordó para Pujols: desde el inicio).
-- - Aplica cuando el plan cobra por sucursal. Con un plan a medida para toda
--   la empresa (sin tarifa por sucursal) no se usa.

alter table public.branches
  add column cuota_mensual numeric(12,2)
    check (cuota_mensual is null or cuota_mensual >= 0);

comment on column public.branches.cuota_mensual is
  'Precio mensual acordado para esta sucursal. Null: la tarifa del plan. 0: no se cobra. Solo lo cambia el super admin.';

create or replace function public.lock_cuota_mensual()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cuota_mensual is distinct from old.cuota_mensual
     and not (auth.uid() is null or public.is_platform_super_admin()) then
    new.cuota_mensual := old.cuota_mensual;
  end if;
  return new;
end;
$$;

revoke all on function public.lock_cuota_mensual() from public, anon, authenticated;

create trigger trg_lock_cuota_mensual
  before update on public.branches
  for each row execute function public.lock_cuota_mensual();

create or replace function public.lock_cuota_mensual_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cuota_mensual is not null
     and not (auth.uid() is null or public.is_platform_super_admin()) then
    new.cuota_mensual := null;
  end if;
  return new;
end;
$$;

revoke all on function public.lock_cuota_mensual_insert() from public, anon, authenticated;

create trigger trg_lock_cuota_mensual_insert
  before insert on public.branches
  for each row execute function public.lock_cuota_mensual_insert();

create or replace function public.poner_cuota_de_sucursal(p_branch_id uuid, p_cuota numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede cambiar el precio de una sucursal.';
  end if;
  if p_cuota is not null and p_cuota < 0 then
    raise exception 'El precio no puede ser negativo.';
  end if;
  update public.branches
     set cuota_mensual = case when p_cuota is null then null else round(p_cuota, 2) end
   where id = p_branch_id;
  if not found then
    raise exception 'Sucursal no encontrada.';
  end if;
end;
$$;

revoke all on function public.poner_cuota_de_sucursal(uuid, numeric) from public, anon;
grant execute on function public.poner_cuota_de_sucursal(uuid, numeric) to authenticated;

-- La cuenta, igual que en 20260926022410_cobros_comprobantes_y_avisos, pero
-- cada sucursal con su precio. Agrega 'precios_especiales' (cuántas
-- sucursales activas tienen precio propio) y, en cada cuenta,
-- 'precio_especial'.
create or replace function public._cuenta_de_suscripcion(p_company_id uuid, p_hoy date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c public.companies%rowtype;
  v_tz text;
  v_hoy date;
  v_plan_id uuid;
  v_custom numeric;
  v_ciclo text;
  v_meses integer;
  v_hay_plan boolean := false;
  v_mensual_plan numeric;
  v_anual_plan numeric;
  v_tarifa numeric;
  v_activas integer;
  v_mensual numeric;
  v_monto_periodo numeric;
  v_pagado numeric;
  v_por_confirmar numeric;
  v_n_por_confirmar integer;
  v_sugerir_dias integer;
  v_fin_prueba date;
  v_inicio date;
  v_base jsonb;
  v_cuentas jsonb;
  v_cargado numeric;
  v_hasta date;
  v_pendientes integer;
  v_cargos_hoy integer;
  v_primera date;
  v_saldo numeric;
  v_dias integer;
  v_especiales integer := 0;
begin
  select * into c from public.companies where id = p_company_id;
  if not found then
    return null;
  end if;

  v_tz := coalesce(nullif(btrim(c.timezone), ''), 'America/Santo_Domingo');
  v_hoy := coalesce(p_hoy, (now() at time zone v_tz)::date);

  select s.plan_id, s.custom_monthly_price, s.billing_cycle
    into v_plan_id, v_custom, v_ciclo
    from public.subscriptions s
   where s.company_id = c.id
   order by s.created_at desc
   limit 1;

  v_ciclo := case when v_ciclo = 'annual' then 'annual' else 'monthly' end;
  v_meses := case when v_ciclo = 'annual' then 12 else 1 end;

  if v_plan_id is not null then
    select p.monthly_price, p.annual_price_per_month
      into v_mensual_plan, v_anual_plan
      from public.plans p where p.id = v_plan_id;
    v_hay_plan := found;
  end if;

  -- Tarifa por sucursal (por mes), o null si el plan no la tiene: entonces
  -- manda el monto mensual acordado para toda la empresa.
  v_tarifa := case
    when not v_hay_plan then null
    when v_ciclo = 'annual' then coalesce(v_anual_plan, v_mensual_plan)
    else v_mensual_plan
  end;

  select count(*) into v_activas
    from public.branches b where b.company_id = c.id and b.is_active;

  -- Cada sucursal paga la tarifa del plan, o su propio precio si el super
  -- admin le puso uno (branches.cuota_mensual). Sin sucursales activas, una
  -- tarifa para toda la empresa.
  if v_tarifa is not null then
    select coalesce(sum(coalesce(b.cuota_mensual, v_tarifa)), 0),
           count(*) filter (where b.cuota_mensual is not null)
      into v_mensual, v_especiales
      from public.branches b where b.company_id = c.id and b.is_active;
    if v_activas = 0 then
      v_mensual := v_tarifa;
    end if;
  else
    v_mensual := coalesce(v_custom, 0);
  end if;
  v_monto_periodo := v_mensual * v_meses;

  select coalesce(sum(amount), 0) into v_pagado
    from public.subscription_payments where company_id = c.id;

  select coalesce(sum(amount), 0), count(*)
    into v_por_confirmar, v_n_por_confirmar
    from public.subscription_payment_reports
   where company_id = c.id and status = 'por_confirmar';

  select coalesce(solo_ventas_sugerir_dias, 10) into v_sugerir_dias
    from public.platform_settings limit 1;
  v_sugerir_dias := coalesce(v_sugerir_dias, 10);

  v_base := jsonb_build_object(
    'company_id', c.id,
    'hoy', v_hoy,
    'estado', 'al_dia',
    'dias', null,
    'dias_atraso', 0,
    'sucursales_activas', v_activas,
    'ciclo', v_ciclo,
    'tarifa_por_sucursal', v_tarifa,
    'mensual', v_mensual,
    'monto_periodo', v_monto_periodo,
    'cuentas', '[]'::jsonb,
    'cargado', 0,
    'pagado', v_pagado,
    'saldo', -v_pagado,
    'cuotas_pendientes', 0,
    'debe_desde', null,
    'proximo_cobro', null,
    'pagar_pendiente', null,
    'por_confirmar', v_por_confirmar,
    'comprobantes_por_confirmar', v_n_por_confirmar,
    'solo_ventas', c.solo_ventas,
    'solo_ventas_desde', c.solo_ventas_desde,
    'sugerir_solo_ventas', false,
    'solo_ventas_sugerir_dias', v_sugerir_dias,
    'cargos_hoy', 0,
    'precios_especiales', v_especiales
  );

  if c.status::text = 'suspended' then
    return v_base || jsonb_build_object('estado', 'suspendida');
  end if;

  if c.status::text = 'trial' then
    if c.trial_ends_at is null then
      return v_base || jsonb_build_object('estado', 'prueba');
    end if;
    v_dias := (c.trial_ends_at at time zone v_tz)::date - v_hoy;
    return v_base || jsonb_build_object(
      'estado', case when v_dias < 0 then 'prueba_vencida' else 'prueba' end,
      'dias', v_dias);
  end if;

  if v_mensual <= 0 then
    return v_base || jsonb_build_object('estado', 'sin_tarifa');
  end if;

  v_fin_prueba := case when c.trial_ends_at is not null
                       then (c.trial_ends_at at time zone v_tz)::date + 1 end;
  v_inicio := greatest((c.created_at at time zone v_tz)::date, v_fin_prueba);

  -- Cuotas vencidas y, detrás, las futuras que hagan falta para ver hasta
  -- dónde alcanza lo pagado. Sumar meses con interval no desborda: el 31/1
  -- más un mes es el 28/2.
  with defs as (
    -- Una sucursal con precio 0 no se cobra: no genera cuotas.
    select b.id as branch_id, b.name as nombre,
           greatest((b.created_at at time zone v_tz)::date, v_fin_prueba) as desde,
           coalesce(b.cuota_mensual, v_tarifa) * v_meses as cuota,
           b.cuota_mensual is not null as precio_especial
      from public.branches b
     where b.company_id = c.id and b.is_active and v_tarifa is not null
       and coalesce(b.cuota_mensual, v_tarifa) > 0
    union all
    select null::uuid, 'Toda la empresa', v_inicio, v_monto_periodo, false
     where v_tarifa is null or v_activas = 0
  ),
  cargos as (
    select d.branch_id, d.nombre, d.desde, d.cuota, d.precio_especial, k,
           (d.desde + make_interval(months => k * v_meses))::date as fecha
      from defs d
     cross join lateral generate_series(
       0,
       greatest(0, ((extract(year from age(v_hoy, d.desde)) * 12
                     + extract(month from age(v_hoy, d.desde)))::integer / v_meses) + 1)
         + ceil((v_pagado + 1) / d.cuota)::integer + 1
     ) as k
  ),
  ordenados as (
    select *,
           fecha <= v_hoy as vencido,
           sum(cuota) over (order by fecha, nombre, branch_id, k rows unbounded preceding) as acumulado
      from cargos
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
              'branch_id', x.branch_id, 'nombre', x.nombre, 'desde', x.desde, 'cuota', x.cuota,
              'cuotas', x.cuotas, 'cargado', x.cargado, 'proxima_cuota', x.proxima,
              'pendientes', x.pendientes, 'debe_desde', x.debe_desde,
              'precio_especial', x.precio_especial)
            order by x.desde, x.nombre), '[]'::jsonb)
       from (select o.branch_id, o.nombre, o.desde, o.cuota, o.precio_especial,
                    count(*) filter (where o.vencido) as cuotas,
                    coalesce(sum(o.cuota) filter (where o.vencido), 0) as cargado,
                    min(o.fecha) filter (where not o.vencido) as proxima,
                    count(*) filter (where o.vencido and o.acumulado > v_pagado + 0.005) as pendientes,
                    min(o.fecha) filter (where o.vencido and o.acumulado > v_pagado + 0.005) as debe_desde
               from ordenados o
              group by o.branch_id, o.nombre, o.desde, o.cuota, o.precio_especial) x),
    (select coalesce(sum(o.cuota), 0) from ordenados o where o.vencido),
    (select min(o.fecha) from ordenados o where not o.vencido),
    (select count(*) from ordenados o where o.vencido and o.acumulado > v_pagado + 0.005),
    (select count(*) from ordenados o where o.fecha = v_hoy),
    (select o.fecha from ordenados o where o.acumulado > v_pagado + 0.005
      order by o.fecha, o.nombre, o.branch_id, o.k limit 1)
  into v_cuentas, v_cargado, v_hasta, v_pendientes, v_cargos_hoy, v_primera;

  v_saldo := round(v_cargado - v_pagado, 2);
  v_base := v_base || jsonb_build_object(
    'cuentas', v_cuentas, 'cargado', v_cargado, 'saldo', v_saldo, 'cargos_hoy', v_cargos_hoy);

  if v_primera is not null and v_primera <= v_hoy then
    v_dias := v_hoy - v_primera;
    return v_base || jsonb_build_object(
      'estado', case when v_pagado > 0 then 'atrasada' else 'nunca_pago' end,
      'dias', -v_dias,
      'dias_atraso', v_dias,
      'cuotas_pendientes', v_pendientes,
      'debe_desde', v_primera,
      'proximo_cobro', v_primera,
      'pagar_pendiente', jsonb_build_object('monto', v_saldo, 'desde', v_primera, 'hasta', v_hasta),
      'sugerir_solo_ventas',
        not c.solo_ventas and v_n_por_confirmar = 0 and v_dias >= v_sugerir_dias
    );
  end if;

  v_dias := v_primera - v_hoy;
  return v_base || jsonb_build_object(
    'estado', case when v_dias <= 7 then 'por_vencer' else 'al_dia' end,
    'dias', v_dias,
    'proximo_cobro', v_primera
  );
end;
$function$;
