-- Cobros de suscripción: la cuenta en la base, comprobantes de pago que sube
-- la empresa y confirma el super admin, cuentas bancarias configurables,
-- avisos por correo y el modo "solo ventas" (manual).
--
-- Contexto: hasta aquí la cuenta (cuotas por sucursal, cuánto debe, desde
-- cuándo) se calculaba en el navegador, en la pantalla de Cobros. El resumen
-- nocturno, los recordatorios y el banner de las empresas corren en otros
-- lados, así que la cuenta pasa a la base para que todos den el mismo número.
--
-- Reglas de la cuenta (las mismas que tenía src/lib/subscription-status.ts):
--   * Cada sucursal ACTIVA carga su cuota por adelantado cada mes (o año si
--     paga anual) desde el día en que se creó, aunque después se haya movido de
--     empresa (Michelle Auto Service nació el 16/7 como sucursal de Pujols).
--     Si la empresa tuvo prueba, desde el día siguiente a que terminó.
--   * El plan a medida es una cuenta de la empresa entera, desde que se creó.
--   * A lo cargado se le resta todo lo pagado, aplicado a las cuotas más viejas.
--   * La tarifa es la de hoy del plan; cuentan las sucursales activas hoy.
--
-- El bloqueo es manual: el super admin pone a una empresa en "solo ventas".
-- La base solo sugiere hacerlo cuando el atraso pasa de
-- platform_settings.solo_ventas_sugerir_dias.

-- ── Configuración ──────────────────────────────────────────────────────────
alter table public.platform_settings
  add column payment_notify_email text
    check (payment_notify_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column solo_ventas_sugerir_dias integer not null default 10
    check (solo_ventas_sugerir_dias between 1 and 365),
  add column avisos_cobro_activos boolean not null default false;

comment on column public.platform_settings.payment_notify_email is
  'A dónde avisar cuando una empresa sube un comprobante, y a dónde va el resumen nocturno de cobros. Vacío: support_email.';
comment on column public.platform_settings.avisos_cobro_activos is
  'Recordatorios de cuota a las empresas (N días antes y el día que vence). Nace apagado: se enciende cuando estén cargadas las cuentas bancarias y la pantalla para reportar el pago.';
comment on column public.platform_settings.solo_ventas_sugerir_dias is
  'Días de atraso a partir de los cuales Cobros y el resumen nocturno sugieren pasar la empresa a solo ventas. No bloquea solo.';

create table public.platform_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank text not null check (btrim(bank) <> ''),
  account_type text not null default 'ahorro' check (account_type in ('ahorro', 'corriente')),
  account_number text not null check (btrim(account_number) <> ''),
  holder_name text not null check (btrim(holder_name) <> ''),
  holder_id text,
  currency text not null default 'DOP' check (currency in ('DOP', 'USD')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_bank_accounts is
  'Cuentas de SellAlleS donde las empresas transfieren la suscripción. Las ven los usuarios autenticados; solo el super admin las edita.';

alter table public.platform_bank_accounts enable row level security;

create policy platform_bank_accounts_select on public.platform_bank_accounts
  for select to authenticated using (true);
create policy platform_bank_accounts_write on public.platform_bank_accounts
  for all to authenticated
  using ((select public.is_platform_super_admin()))
  with check ((select public.is_platform_super_admin()));

revoke all on public.platform_bank_accounts from anon;
grant select, insert, update, delete on public.platform_bank_accounts to authenticated;

-- ── Solo ventas ────────────────────────────────────────────────────────────
alter table public.companies
  add column solo_ventas boolean not null default false,
  add column solo_ventas_desde timestamptz;

comment on column public.companies.solo_ventas is
  'Puesta a mano por el super admin por atraso en la suscripción: la app deja vender, cobrar y pagar la suscripción, y deja lo demás en solo lectura.';

-- companies_update deja escribir la fila a cualquier usuario de la empresa;
-- esta bandera solo la cambia el super admin (o un proceso del sistema, sin
-- usuario). Igual que el nombre en lock_company_name: se revierte en silencio.
create or replace function public.lock_solo_ventas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.solo_ventas is distinct from old.solo_ventas
      or new.solo_ventas_desde is distinct from old.solo_ventas_desde)
     and auth.uid() is not null
     and not public.is_platform_super_admin() then
    new.solo_ventas := old.solo_ventas;
    new.solo_ventas_desde := old.solo_ventas_desde;
  end if;
  return new;
end;
$$;

revoke all on function public.lock_solo_ventas() from public, anon, authenticated;

create trigger trg_lock_solo_ventas
  before update on public.companies
  for each row execute function public.lock_solo_ventas();

create or replace function public.poner_solo_ventas(p_company_id uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede cambiar el modo solo ventas.';
  end if;
  update public.companies
     set solo_ventas = coalesce(p_activo, false),
         solo_ventas_desde = case when coalesce(p_activo, false) then now() end
   where id = p_company_id;
  if not found then
    raise exception 'Empresa no encontrada.';
  end if;
end;
$$;

revoke all on function public.poner_solo_ventas(uuid, boolean) from public, anon;
grant execute on function public.poner_solo_ventas(uuid, boolean) to authenticated;

-- ── Comprobantes ───────────────────────────────────────────────────────────
-- Bucket aparte del de "comprobantes" (recibos de venta en PDF): ese lo vacía
-- a diario limpiar-comprobantes, y estos son evidencia contable que se guarda.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes-de-pago', 'comprobantes-de-pago', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

-- La primera carpeta es la empresa. Sube y ve el admin de esa empresa; ve
-- también el super admin. Nadie borra ni reemplaza desde la app.
create policy comprobantes_de_pago_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes-de-pago'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (select public.is_company_admin())
  );

create policy comprobantes_de_pago_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes-de-pago'
    and (
      ((storage.foldername(name))[1] = (select public.current_company_id())::text
        and (select public.is_company_admin()))
      or (select public.is_super_admin())
    )
  );

create table public.subscription_payment_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null,
  bank_account_id uuid references public.platform_bank_accounts(id) on delete set null,
  -- Copia de la cuenta al reportar: si después se edita o se borra, el
  -- reporte sigue diciendo a dónde dijo el cliente que transfirió.
  bank_label text,
  reference text,
  notes text,
  file_path text not null,
  file_name text,
  file_mime text,
  file_sha256 text,
  status text not null default 'por_confirmar'
    check (status in ('por_confirmar', 'confirmado', 'rechazado', 'anulado')),
  confirmed_amount numeric(12,2),
  reject_reason text,
  payment_id uuid references public.subscription_payments(id) on delete set null,
  reported_by uuid references public.profiles(id) on delete set null,
  reported_by_name text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.subscription_payment_reports is
  'Pagos por transferencia que reporta una empresa con su comprobante. Solo al confirmarlos el super admin se crea el pago (subscription_payments) y su factura.';

create index subscription_payment_reports_company_idx
  on public.subscription_payment_reports (company_id, created_at desc);
create index subscription_payment_reports_pendientes_idx
  on public.subscription_payment_reports (created_at)
  where status = 'por_confirmar';
create index subscription_payment_reports_sha_idx
  on public.subscription_payment_reports (file_sha256)
  where file_sha256 is not null;
create index subscription_payment_reports_bank_idx on public.subscription_payment_reports (bank_account_id);
create index subscription_payment_reports_payment_idx on public.subscription_payment_reports (payment_id);
create index subscription_payment_reports_reported_by_idx on public.subscription_payment_reports (reported_by);
create index subscription_payment_reports_reviewed_by_idx on public.subscription_payment_reports (reviewed_by);

alter table public.subscription_payment_reports enable row level security;

create policy subscription_payment_reports_select on public.subscription_payment_reports
  for select to authenticated
  using (
    (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
    or (select public.is_super_admin())
  );

revoke all on public.subscription_payment_reports from anon;
revoke insert, update, delete on public.subscription_payment_reports from authenticated;
grant select on public.subscription_payment_reports to authenticated;

-- ── La cuenta ──────────────────────────────────────────────────────────────
-- Interna: sin control de acceso, la usan las envolturas de abajo y los
-- procesos programados. No se expone a la API.
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

  v_mensual := case
    when v_tarifa is not null then v_tarifa * greatest(v_activas, 1)
    else coalesce(v_custom, 0)
  end;
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
    'cargos_hoy', 0
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
    select b.id as branch_id, b.name as nombre,
           greatest((b.created_at at time zone v_tz)::date, v_fin_prueba) as desde,
           v_tarifa * v_meses as cuota
      from public.branches b
     where b.company_id = c.id and b.is_active and v_tarifa is not null
    union all
    select null::uuid, 'Toda la empresa', v_inicio, v_monto_periodo
     where v_tarifa is null or v_activas = 0
  ),
  cargos as (
    select d.branch_id, d.nombre, d.desde, d.cuota, k,
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
              'pendientes', x.pendientes, 'debe_desde', x.debe_desde)
            order by x.desde, x.nombre), '[]'::jsonb)
       from (select o.branch_id, o.nombre, o.desde, o.cuota,
                    count(*) filter (where o.vencido) as cuotas,
                    coalesce(sum(o.cuota) filter (where o.vencido), 0) as cargado,
                    min(o.fecha) filter (where not o.vencido) as proxima,
                    count(*) filter (where o.vencido and o.acumulado > v_pagado + 0.005) as pendientes,
                    min(o.fecha) filter (where o.vencido and o.acumulado > v_pagado + 0.005) as debe_desde
               from ordenados o
              group by o.branch_id, o.nombre, o.desde, o.cuota) x),
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

comment on function public._cuenta_de_suscripcion(uuid, date) is
  'Cuenta de la suscripción de una empresa (cuotas por sucursal, pagado, saldo, atraso) en jsonb. Interna: sin control de acceso.';

revoke all on function public._cuenta_de_suscripcion(uuid, date) from public, anon, authenticated;

create or replace function public.mi_cuenta_de_suscripcion()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    return null;
  end if;
  return public._cuenta_de_suscripcion(v_company);
end;
$$;

revoke all on function public.mi_cuenta_de_suscripcion() from public, anon;
grant execute on function public.mi_cuenta_de_suscripcion() to authenticated;

create or replace function public.cuentas_de_suscripcion()
returns table (company_id uuid, cuenta jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede ver las cuentas de todas las empresas.';
  end if;
  return query
    select c.id, public._cuenta_de_suscripcion(c.id) from public.companies c;
end;
$$;

revoke all on function public.cuentas_de_suscripcion() from public, anon;
grant execute on function public.cuentas_de_suscripcion() to authenticated;

-- ── Reportar, retirar, confirmar, rechazar ─────────────────────────────────
create or replace function public.reportar_pago_de_suscripcion(
  p_amount numeric,
  p_paid_at date,
  p_bank_account_id uuid,
  p_reference text,
  p_notes text,
  p_file_path text,
  p_file_name text,
  p_file_mime text,
  p_file_sha256 text
) returns public.subscription_payment_reports
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := public.current_company_id();
  v_banco text;
  v_row public.subscription_payment_reports%rowtype;
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'Solo el administrador de la empresa puede reportar pagos.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if p_paid_at is null or p_paid_at > public.company_today(v_company) then
    raise exception 'La fecha del pago no puede ser futura.';
  end if;
  if p_file_path is null or split_part(p_file_path, '/', 1) <> v_company::text then
    raise exception 'El comprobante no pertenece a esta empresa.';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'comprobantes-de-pago' and name = p_file_path
  ) then
    raise exception 'No se encontró el comprobante subido. Vuelve a adjuntarlo.';
  end if;
  if nullif(btrim(p_file_sha256), '') is not null and exists (
    select 1 from public.subscription_payment_reports
     where company_id = v_company and file_sha256 = p_file_sha256
       and status in ('por_confirmar', 'confirmado')
  ) then
    raise exception 'Ese comprobante ya lo enviaste antes.';
  end if;

  if p_bank_account_id is not null then
    select a.bank || ' · ' || initcap(a.account_type) || ' · ' || a.account_number
      into v_banco
      from public.platform_bank_accounts a where a.id = p_bank_account_id;
    if v_banco is null then
      raise exception 'La cuenta bancaria elegida no existe.';
    end if;
  end if;

  insert into public.subscription_payment_reports (
    company_id, amount, paid_at, bank_account_id, bank_label, reference, notes,
    file_path, file_name, file_mime, file_sha256, reported_by, reported_by_name
  ) values (
    v_company, round(p_amount, 2), p_paid_at, p_bank_account_id, v_banco,
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''),
    p_file_path, nullif(btrim(p_file_name), ''), nullif(btrim(p_file_mime), ''),
    nullif(btrim(p_file_sha256), ''),
    auth.uid(), (select name from public.profiles where id = auth.uid())
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.reportar_pago_de_suscripcion(numeric, date, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.reportar_pago_de_suscripcion(numeric, date, uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.anular_reporte_de_pago(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_company_admin() then
    raise exception 'Solo el administrador de la empresa puede retirar un comprobante.';
  end if;
  update public.subscription_payment_reports
     set status = 'anulado', reviewed_at = now()
   where id = p_report_id
     and company_id = public.current_company_id()
     and status = 'por_confirmar';
  if not found then
    raise exception 'Solo se puede retirar un comprobante que todavía está por confirmar.';
  end if;
end;
$$;

revoke all on function public.anular_reporte_de_pago(uuid) from public, anon;
grant execute on function public.anular_reporte_de_pago(uuid) to authenticated;

-- Confirmar es lo único que crea el pago y, con él, la factura numerada.
create or replace function public.confirmar_reporte_de_pago(
  p_report_id uuid,
  p_amount numeric default null,
  p_period_start date default null,
  p_period_end date default null,
  p_activate boolean default false,
  p_notes text default null
) returns public.subscription_payments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.subscription_payment_reports%rowtype;
  v_plan text;
  v_pago public.subscription_payments%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede confirmar pagos.';
  end if;

  select * into r from public.subscription_payment_reports where id = p_report_id for update;
  if not found then
    raise exception 'Comprobante no encontrado.';
  end if;
  if r.status <> 'por_confirmar' then
    raise exception 'Este comprobante ya fue revisado.';
  end if;

  select p.name into v_plan
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.company_id = r.company_id
   order by s.created_at desc limit 1;

  select * into v_pago from public.record_subscription_payment(
    r.company_id,
    coalesce(p_amount, r.amount),
    r.paid_at,
    'transfer',
    r.reference,
    p_period_start,
    p_period_end,
    v_plan,
    concat_ws(' · ',
      nullif(btrim(p_notes), ''),
      'Transferencia reportada' || coalesce(' por ' || r.reported_by_name, ''),
      r.bank_label),
    coalesce(p_activate, false)
  );

  update public.subscription_payment_reports
     set status = 'confirmado',
         confirmed_amount = v_pago.amount,
         payment_id = v_pago.id,
         reviewed_by = auth.uid(),
         reviewed_by_name = (select name from public.profiles where id = auth.uid()),
         reviewed_at = now()
   where id = r.id;

  return v_pago;
end;
$$;

revoke all on function public.confirmar_reporte_de_pago(uuid, numeric, date, date, boolean, text) from public, anon;
grant execute on function public.confirmar_reporte_de_pago(uuid, numeric, date, date, boolean, text) to authenticated;

create or replace function public.rechazar_reporte_de_pago(p_report_id uuid, p_motivo text)
returns public.subscription_payment_reports
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.subscription_payment_reports%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede rechazar pagos.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo del rechazo: el cliente lo va a ver.';
  end if;
  update public.subscription_payment_reports
     set status = 'rechazado',
         reject_reason = btrim(p_motivo),
         reviewed_by = auth.uid(),
         reviewed_by_name = (select name from public.profiles where id = auth.uid()),
         reviewed_at = now()
   where id = p_report_id and status = 'por_confirmar'
  returning * into v_row;
  if not found then
    raise exception 'Este comprobante ya fue revisado o no existe.';
  end if;
  return v_row;
end;
$$;

revoke all on function public.rechazar_reporte_de_pago(uuid, text) from public, anon;
grant execute on function public.rechazar_reporte_de_pago(uuid, text) to authenticated;

-- ── Correos ────────────────────────────────────────────────────────────────
-- Se mandan desde la base con la service role key de Vault, igual que
-- notificar_ciclo_de_vida: no dependen de que el navegador de quien sube el
-- comprobante termine bien.
create or replace function public._enviar_correo_plataforma(
  p_template text, p_to text, p_company_id uuid, p_dedupe text, p_vars jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
begin
  if nullif(btrim(p_to), '') is null then
    return;
  end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise warning '_enviar_correo_plataforma: falta service_role_key en Vault; no se envía %.', p_template;
    return;
  end if;
  perform net.http_post(
    url     := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object(
      'template', p_template, 'to', p_to, 'companyId', p_company_id,
      'dedupeKey', p_dedupe, 'vars', p_vars)
  );
end;
$$;

revoke all on function public._enviar_correo_plataforma(text, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public._correo_avisos_de_pago()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(nullif(btrim(payment_notify_email), ''), nullif(btrim(support_email), ''))
    from public.platform_settings limit 1;
$$;

revoke all on function public._correo_avisos_de_pago() from public, anon, authenticated;

create or replace function public._cuentas_bancarias_json()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'bank', bank, 'type', account_type, 'number', account_number,
           'holder', holder_name, 'holderId', holder_id, 'currency', currency)
         order by sort_order, bank), '[]'::jsonb)
    from public.platform_bank_accounts where is_active;
$$;

revoke all on function public._cuentas_bancarias_json() from public, anon, authenticated;

create or replace function public.avisar_comprobante_recibido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cuenta jsonb := public._cuenta_de_suscripcion(new.company_id);
begin
  perform public._enviar_correo_plataforma(
    'comprobante-recibido',
    public._correo_avisos_de_pago(),
    new.company_id,
    'comprobante:' || new.id,
    jsonb_build_object(
      'companyName', (select name from public.companies where id = new.company_id),
      'amount', new.amount,
      'paidAt', new.paid_at,
      'bank', new.bank_label,
      'reference', new.reference,
      'notes', new.notes,
      'reportedBy', new.reported_by_name,
      'saldo', v_cuenta ->> 'saldo',
      'cuotasPendientes', v_cuenta ->> 'cuotas_pendientes'
    )
  );
  return new;
end;
$$;

revoke all on function public.avisar_comprobante_recibido() from public, anon, authenticated;

create trigger trg_avisar_comprobante_recibido
  after insert on public.subscription_payment_reports
  for each row execute function public.avisar_comprobante_recibido();

-- Recordatorios a las empresas, ahora por la cuenta y no por paid_until (que
-- nadie tiene lleno). Se conserva el aviso de prueba tal cual.
create or replace function public.notificar_ciclo_de_vida()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key           text;
  v_url           text := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email';
  v_avisos_prueba integer[];
  v_avisos_cobro  integer[];
  v_bancos        jsonb := public._cuentas_bancarias_json();
  v_cobros_activos boolean;
  r               record;
  v_cuenta        jsonb;
  v_dias          integer;
  v_monto         numeric;
  n               integer := 0;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise warning 'notificar_ciclo_de_vida: falta el secreto service_role_key en Vault; no se envio nada.';
    return 0;
  end if;

  select coalesce(trial_reminder_days, '{7,3,1}'),
         coalesce(payment_reminder_days, '{3}'),
         avisos_cobro_activos
    into v_avisos_prueba, v_avisos_cobro, v_cobros_activos
    from public.platform_settings limit 1;
  v_avisos_prueba := coalesce(v_avisos_prueba, '{7,3,1}');
  v_avisos_cobro  := coalesce(v_avisos_cobro,  '{3}');

  for r in
    select distinct on (c.id)
           c.id, c.name, c.trial_ends_at,
           (c.trial_ends_at::date - company_today(c.id)) as dias,
           p.email, p.name as user_name
      from public.companies c
      join public.profiles  p on p.company_id = c.id
     where c.status::text = 'trial'
       and c.is_demo = false
       and c.trial_ends_at is not null
       and p.role::text = 'admin'
       and p.email is not null
       and p.email_bounced_at is null
       and p.is_active
       and ( (c.trial_ends_at::date - company_today(c.id)) = any(v_avisos_prueba)
          or (c.trial_ends_at::date - company_today(c.id)) between -1 and 0 )
     order by c.id, p.created_at
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object(
        'template',  case when r.dias > 0 then 'prueba-por-vencer' else 'prueba-vencida' end,
        'to',        r.email,
        'companyId', r.id,
        'dedupeKey', r.id::text || ':prueba:' || r.trial_ends_at::date::text || ':' ||
                     case when r.dias > 0 then r.dias::text || 'd' else 'vencida' end,
        'vars', jsonb_build_object(
          'companyName', r.name, 'userName', r.user_name,
          'trialEndsAt', r.trial_ends_at, 'daysLeft', r.dias
        )
      )
    );
    n := n + 1;
  end loop;

  -- Cuotas: N días antes (payment_reminder_days) y el día que vence una sin
  -- pagar. A quien ya subió un comprobante que está por confirmar no se le
  -- insiste. Solo si el super admin encendió los avisos de cobro.
  if not coalesce(v_cobros_activos, false) then
    return n;
  end if;

  for r in
    select distinct on (c.id)
           c.id, c.name, p.email, p.name as user_name
      from public.companies c
      join public.profiles  p on p.company_id = c.id
     where c.status::text = 'active'
       and c.is_demo = false
       and p.role::text = 'admin'
       and p.email is not null
       and p.email_bounced_at is null
       and p.is_active
     order by c.id, p.created_at
  loop
    v_cuenta := public._cuenta_de_suscripcion(r.id);
    continue when v_cuenta is null
               or (v_cuenta ->> 'comprobantes_por_confirmar')::integer > 0;

    if v_cuenta ->> 'estado' in ('al_dia', 'por_vencer') then
      v_dias := (v_cuenta ->> 'dias')::integer;
      continue when not (v_dias = any(v_avisos_cobro));
      select coalesce(sum((e ->> 'cuota')::numeric), 0) into v_monto
        from jsonb_array_elements(v_cuenta -> 'cuentas') e
       where (e ->> 'proxima_cuota') = (v_cuenta ->> 'proximo_cobro');
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
        body := jsonb_build_object(
          'template',  'cobro-por-vencer',
          'to',        r.email,
          'companyId', r.id,
          'dedupeKey', r.id::text || ':cuota:' || (v_cuenta ->> 'proximo_cobro') || ':' || v_dias::text || 'd',
          'vars', jsonb_build_object(
            'companyName', r.name, 'userName', r.user_name,
            'dueDate', v_cuenta ->> 'proximo_cobro', 'daysLeft', v_dias,
            'amount', v_monto, 'bankAccounts', v_bancos
          )
        )
      );
      n := n + 1;
    elsif v_cuenta ->> 'estado' in ('atrasada', 'nunca_pago')
          and (v_cuenta ->> 'cargos_hoy')::integer > 0 then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
        body := jsonb_build_object(
          'template',  'cuota-vencida',
          'to',        r.email,
          'companyId', r.id,
          'dedupeKey', r.id::text || ':cuota-vencida:' || (v_cuenta ->> 'hoy'),
          'vars', jsonb_build_object(
            'companyName', r.name, 'userName', r.user_name,
            'saldo', v_cuenta ->> 'saldo', 'cuotasPendientes', v_cuenta ->> 'cuotas_pendientes',
            'debeDesde', v_cuenta ->> 'debe_desde', 'bankAccounts', v_bancos
          )
        )
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$function$;

-- Resumen nocturno para el super admin: un solo correo, y solo si hay algo.
create or replace function public.enviar_resumen_de_cobros()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_to text := public._correo_avisos_de_pago();
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_pendientes jsonb;
  v_atrasados jsonb;
  v_por_vencer jsonb;
begin
  if v_to is null then
    return 0;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'companyName', c.name, 'amount', r.amount, 'paidAt', r.paid_at,
           'bank', r.bank_label, 'reference', r.reference, 'reportedAt', r.created_at)
         order by r.created_at), '[]'::jsonb)
    into v_pendientes
    from public.subscription_payment_reports r
    join public.companies c on c.id = r.company_id
   where r.status = 'por_confirmar';

  with cuentas as (
    select c.id, c.name, public._cuenta_de_suscripcion(c.id) as cuenta
      from public.companies c
     where not c.is_demo and c.status::text = 'active'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
        'companyName', x.name,
        'saldo', x.cuenta -> 'saldo',
        'diasAtraso', x.cuenta -> 'dias_atraso',
        'cuotasPendientes', x.cuenta -> 'cuotas_pendientes',
        'debeDesde', x.cuenta -> 'debe_desde',
        'nuncaPago', x.cuenta ->> 'estado' = 'nunca_pago',
        'soloVentas', x.cuenta -> 'solo_ventas',
        'sugerirSoloVentas', x.cuenta -> 'sugerir_solo_ventas',
        'porConfirmar', x.cuenta -> 'por_confirmar',
        'sucursales', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'nombre', e ->> 'nombre', 'pendientes', e -> 'pendientes', 'debeDesde', e -> 'debe_desde')), '[]'::jsonb)
            from jsonb_array_elements(x.cuenta -> 'cuentas') e
           where (e ->> 'pendientes')::integer > 0)
      ) order by (x.cuenta ->> 'dias_atraso')::integer desc)
      filter (where x.cuenta ->> 'estado' in ('atrasada', 'nunca_pago')), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
        'companyName', x.name,
        'proximoCobro', x.cuenta -> 'proximo_cobro',
        'dias', x.cuenta -> 'dias',
        'mensual', x.cuenta -> 'mensual')
      order by (x.cuenta ->> 'dias')::integer)
      filter (where x.cuenta ->> 'estado' = 'por_vencer'), '[]'::jsonb)
    into v_atrasados, v_por_vencer
    from cuentas x;

  if jsonb_array_length(v_pendientes) = 0
     and jsonb_array_length(v_atrasados) = 0
     and jsonb_array_length(v_por_vencer) = 0 then
    return 0;
  end if;

  perform public._enviar_correo_plataforma(
    'resumen-cobros', v_to, null, 'resumen-cobros:' || v_hoy::text,
    jsonb_build_object(
      'fecha', v_hoy,
      'pendientes', v_pendientes,
      'atrasados', v_atrasados,
      'porVencer', v_por_vencer
    )
  );
  return 1;
end;
$$;

revoke all on function public.enviar_resumen_de_cobros() from public, anon, authenticated;

-- 8:05 p.m. en RD (UTC-4, sin horario de verano).
select cron.schedule('resumen-de-cobros', '5 0 * * *', $cron$ select public.enviar_resumen_de_cobros(); $cron$);
