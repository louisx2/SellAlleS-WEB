-- Precio especial con fecha de fin, y activar una empresa en prueba.
--
-- 1. branches.cuota_mensual_hasta: el precio especial de una sucursal
--    (cuota_mensual) vale para las cuotas que vencen hasta ese día; las
--    siguientes pagan la tarifa del plan. Null: sin fin, como hasta ahora.
--    Sirve para descuentos de unos meses (POPI Pets Shop: RD$1,950 tres meses
--    por traer un cliente, luego Pro normal). Antes, quitar el precio especial
--    al terminar el descuento recalculaba también las cuotas ya cobradas.
--
-- 2. _cuenta_de_suscripcion: cada cuota con el precio que le toca según su
--    fecha. 'mensual', 'precios_especiales' y 'precio_especial' miran el
--    precio vigente hoy. Cada cuenta trae además 'precio_especial_hasta'.
--    Lo demás, igual que la versión viva (20260926170206_precio_por_sucursal).
--
-- 3. poner_cuota_de_sucursal(branch, cuota, hasta): el mismo RPC con la fecha
--    de fin opcional. Las llamadas de dos argumentos siguen funcionando.
--
-- 4. activar_empresa: pasa una empresa de prueba a activa de una sola vez:
--    plan, ciclo, día de la primera cuota (trial_ends_at = el día anterior,
--    que es de donde sale el inicio del cobro) y un precio especial opcional
--    por unas cuotas. Antes, cambiar el estado a Activa sin mover la fecha de
--    la prueba le cargaba de golpe todos los meses desde que la prueba venció.

-- ── 1. Columna ─────────────────────────────────────────────────────────────

alter table public.branches
  add column if not exists cuota_mensual_hasta date;

comment on column public.branches.cuota_mensual_hasta is
  'Último día de cuota en que vale cuota_mensual; las cuotas posteriores pagan la tarifa del plan. Null: sin fin. Solo lo cambia el super admin.';

-- Los candados de cuota_mensual también cubren la fecha de fin.
create or replace function public.lock_cuota_mensual()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.cuota_mensual is distinct from old.cuota_mensual
      or new.cuota_mensual_hasta is distinct from old.cuota_mensual_hasta)
     and not (auth.uid() is null or public.is_platform_super_admin()) then
    new.cuota_mensual := old.cuota_mensual;
    new.cuota_mensual_hasta := old.cuota_mensual_hasta;
  end if;
  return new;
end;
$$;

create or replace function public.lock_cuota_mensual_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.cuota_mensual is not null or new.cuota_mensual_hasta is not null)
     and not (auth.uid() is null or public.is_platform_super_admin()) then
    new.cuota_mensual := null;
    new.cuota_mensual_hasta := null;
  end if;
  return new;
end;
$$;

-- ── 2. La cuenta ───────────────────────────────────────────────────────────

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
  -- admin le puso uno (branches.cuota_mensual) y sigue vigente hoy. Sin
  -- sucursales activas, una tarifa para toda la empresa.
  if v_tarifa is not null then
    select coalesce(sum(case
                          when b.cuota_mensual is not null
                           and (b.cuota_mensual_hasta is null or b.cuota_mensual_hasta >= v_hoy)
                          then b.cuota_mensual else v_tarifa end), 0),
           count(*) filter (where b.cuota_mensual is not null
                              and (b.cuota_mensual_hasta is null or b.cuota_mensual_hasta >= v_hoy))
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
  -- más un mes es el 28/2. Cada cuota lleva el precio de su fecha: el
  -- especial mientras no pase cuota_mensual_hasta, y luego la tarifa.
  with defs as (
    select b.id as branch_id, b.name as nombre,
           greatest((b.created_at at time zone v_tz)::date, v_fin_prueba) as desde,
           b.cuota_mensual as especial,
           b.cuota_mensual_hasta as especial_hasta,
           -- La cuota más baja que puede tocarle (para saber cuántas generar).
           coalesce(least(nullif(b.cuota_mensual, 0), nullif(v_tarifa, 0)), 0) * v_meses as cuota_min
      from public.branches b
     where b.company_id = c.id and b.is_active and v_tarifa is not null
    union all
    select null::uuid, 'Toda la empresa', v_inicio, null::numeric, null::date, v_monto_periodo
     where v_tarifa is null or v_activas = 0
  ),
  cargos_todos as (
    select d.branch_id, d.nombre, d.desde, d.especial_hasta, k, f.fecha,
           case
             when d.branch_id is null then v_monto_periodo
             when d.especial is not null and (d.especial_hasta is null or f.fecha <= d.especial_hasta)
               then d.especial * v_meses
             else v_tarifa * v_meses
           end as cuota,
           d.branch_id is not null and d.especial is not null
             and (d.especial_hasta is null or f.fecha <= d.especial_hasta) as precio_especial
      from defs d
     cross join lateral generate_series(
       0,
       case when d.cuota_min > 0 then
         greatest(0, ((extract(year from age(v_hoy, d.desde)) * 12
                       + extract(month from age(v_hoy, d.desde)))::integer / v_meses) + 1)
           + ceil((v_pagado + 1) / d.cuota_min)::integer + 1
       else -1 end
     ) as k
     cross join lateral (select (d.desde + make_interval(months => k * v_meses))::date as fecha) f
  ),
  -- Una cuota de precio 0 no se cobra: no cuenta.
  cargos as (
    select * from cargos_todos where cuota > 0
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
              'precio_especial', x.precio_especial,
              'precio_especial_hasta', x.especial_hasta)
            order by x.desde, x.nombre), '[]'::jsonb)
       from (select o.branch_id, o.nombre, o.desde, o.especial_hasta,
                    -- La cuota que sigue (o la última, si ya no hay más).
                    coalesce((array_agg(o.cuota order by o.fecha) filter (where not o.vencido))[1],
                             (array_agg(o.cuota order by o.fecha desc))[1]) as cuota,
                    coalesce((array_agg(o.precio_especial order by o.fecha) filter (where not o.vencido))[1],
                             (array_agg(o.precio_especial order by o.fecha desc))[1]) as precio_especial,
                    count(*) filter (where o.vencido) as cuotas,
                    coalesce(sum(o.cuota) filter (where o.vencido), 0) as cargado,
                    min(o.fecha) filter (where not o.vencido) as proxima,
                    count(*) filter (where o.vencido and o.acumulado > v_pagado + 0.005) as pendientes,
                    min(o.fecha) filter (where o.vencido and o.acumulado > v_pagado + 0.005) as debe_desde
               from ordenados o
              group by o.branch_id, o.nombre, o.desde, o.especial_hasta) x),
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

-- ── 3. Poner el precio de una sucursal ─────────────────────────────────────

drop function if exists public.poner_cuota_de_sucursal(uuid, numeric);

create function public.poner_cuota_de_sucursal(p_branch_id uuid, p_cuota numeric, p_hasta date default null)
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
     set cuota_mensual = case when p_cuota is null then null else round(p_cuota, 2) end,
         -- Sin precio especial no hay fecha de fin.
         cuota_mensual_hasta = case when p_cuota is null then null else p_hasta end
   where id = p_branch_id;
  if not found then
    raise exception 'Sucursal no encontrada.';
  end if;
end;
$$;

revoke all on function public.poner_cuota_de_sucursal(uuid, numeric, date) from public, anon;
grant execute on function public.poner_cuota_de_sucursal(uuid, numeric, date) to authenticated, service_role;

-- ── 4. Activar una empresa en prueba ───────────────────────────────────────

create or replace function public.activar_empresa(
  p_company_id uuid,
  p_plan_id uuid,
  p_ciclo text,
  p_primer_cobro date,
  -- Monto mensual acordado, para los planes sin tarifa por sucursal (A medida).
  p_precio_acordado numeric default null,
  -- Precio especial por sucursal durante las primeras p_especial_cuotas cuotas.
  p_precio_especial numeric default null,
  p_especial_cuotas integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.companies%rowtype;
  v_tz text;
  v_meses integer;
  v_hay_tarifa boolean;
  v_sub uuid;
  v_hasta date;
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede activar empresas.';
  end if;

  select * into c from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'Empresa no encontrada.';
  end if;
  if c.status::text <> 'trial' then
    raise exception 'La empresa no está en prueba: para una suspendida use Reactivar.';
  end if;
  if p_ciclo is null or p_ciclo not in ('monthly', 'annual') then
    raise exception 'Ciclo de cobro inválido.';
  end if;
  if p_primer_cobro is null then
    raise exception 'Falta el día de la primera cuota.';
  end if;

  select p.monthly_price is not null into v_hay_tarifa from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'Plan no encontrado.';
  end if;
  if not v_hay_tarifa and (p_precio_acordado is null or p_precio_acordado <= 0) then
    raise exception 'Este plan no tiene tarifa: falta el monto mensual acordado.';
  end if;
  if p_precio_especial is not null then
    if not v_hay_tarifa then
      raise exception 'El precio especial por sucursal solo aplica a planes con tarifa por sucursal.';
    end if;
    if p_precio_especial < 0 then
      raise exception 'El precio especial no puede ser negativo.';
    end if;
    if p_especial_cuotas is null or p_especial_cuotas < 1 then
      raise exception 'Indique por cuántas cuotas vale el precio especial.';
    end if;
  end if;

  v_tz := coalesce(nullif(btrim(c.timezone), ''), 'America/Santo_Domingo');
  v_meses := case when p_ciclo = 'annual' then 12 else 1 end;

  -- La cuenta cobra desde el día siguiente al fin de la prueba: la prueba
  -- termina al final del día anterior a la primera cuota.
  update public.companies
     set status = 'active',
         trial_ends_at = ((p_primer_cobro - 1)::timestamp + time '23:59:59') at time zone v_tz
   where id = c.id;

  select s.id into v_sub from public.subscriptions s
   where s.company_id = c.id order by s.created_at desc limit 1;
  if v_sub is null then
    insert into public.subscriptions (company_id, plan_id, status, billing_cycle, custom_monthly_price)
    values (c.id, p_plan_id, 'active', p_ciclo, case when v_hay_tarifa then null else round(p_precio_acordado, 2) end);
  else
    update public.subscriptions
       set plan_id = p_plan_id, status = 'active', billing_cycle = p_ciclo,
           custom_monthly_price = case when v_hay_tarifa then null else round(p_precio_acordado, 2) end
     where id = v_sub;
  end if;

  if p_precio_especial is not null then
    v_hasta := (p_primer_cobro + make_interval(months => (p_especial_cuotas - 1) * v_meses))::date;
    update public.branches
       set cuota_mensual = round(p_precio_especial, 2), cuota_mensual_hasta = v_hasta
     where company_id = c.id and is_active;
  end if;

  return public._cuenta_de_suscripcion(c.id);
end;
$$;

revoke all on function public.activar_empresa(uuid, uuid, text, date, numeric, numeric, integer) from public, anon;
grant execute on function public.activar_empresa(uuid, uuid, text, date, numeric, numeric, integer) to authenticated, service_role;
