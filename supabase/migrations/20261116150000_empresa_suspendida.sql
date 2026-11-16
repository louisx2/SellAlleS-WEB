-- ============================================================================
-- Empresa suspendida: que suspender signifique lo mismo en todas partes
-- ============================================================================
-- Hasta ahora "suspender" solo cambiaba companies.status y la app mostraba una
-- pantalla de bloqueo al cargar. La base no lo hacía cumplir (un usuario con la
-- app abierta seguía vendiendo hasta recargar), los recordatorios de cuotas a
-- los clientes de la empresa seguían saliendo, y reactivar siempre la dejaba
-- "Activa", aunque viniera de una prueba vencida sin pagar.
--
--   1. companies.suspension_reason y suspended_at: el motivo decide el mensaje
--      que ve la empresa. Un trigger los mantiene coherentes con status, venga
--      el cambio de donde venga (RPC, formulario del super admin, un pago
--      confirmado que la activa).
--   2. Bloqueo en la base: las tablas operativas rechazan escrituras de los
--      usuarios de una empresa suspendida. El super admin, los crons y las
--      funciones del servidor (sin auth.uid()) siguen pudiendo escribir: así
--      los e-CF ya emitidos terminan de llegar a la DGII.
--   3. pending_due_reminders no devuelve cuotas de empresas suspendidas: no sale
--      ningún recordatorio a su nombre. Al reactivarla salen los que falten.
--   4. suspender_empresa / reactivar_empresa (solo super admin): cambian el
--      estado y, si se pide, avisan por correo al administrador de la empresa.
--      Reactivar obliga a elegir: prueba hasta una fecha, o activa (con o sin
--      modo solo facturación).
--   5. correo_admin_de_empresa: a quién le llegaría el aviso, para mostrarlo en
--      el diálogo antes de decidir si se envía.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Motivo y fecha de la suspensión
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists suspension_reason text,
  add column if not exists suspended_at timestamptz;

alter table public.companies drop constraint if exists companies_suspension_reason_check;
alter table public.companies add constraint companies_suspension_reason_check
  check (suspension_reason is null or suspension_reason in ('falta_de_pago', 'solicitud_cliente', 'revision'));

comment on column public.companies.suspension_reason is
  'Por qué está suspendida: falta_de_pago, solicitud_cliente o revision. Null si no está suspendida.';
comment on column public.companies.suspended_at is
  'Desde cuándo está suspendida. Null si no está suspendida.';

create or replace function public.companies_suspension_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text = 'suspended' then
    if tg_op = 'INSERT' or old.status::text <> 'suspended' then
      new.suspended_at := now();
    end if;
    -- Suspendida sin motivo (p. ej. desde el formulario): revisión administrativa.
    new.suspension_reason := coalesce(new.suspension_reason, 'revision');
  else
    new.suspension_reason := null;
    new.suspended_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_companies_suspension_fields on public.companies;
create trigger trg_companies_suspension_fields
  before insert or update of status, suspension_reason, suspended_at on public.companies
  for each row execute function public.companies_suspension_fields();

-- Las ya suspendidas quedan como revisión, desde hoy.
update public.companies
   set suspension_reason = 'revision'
 where status::text = 'suspended' and suspension_reason is null;

-- ---------------------------------------------------------------------------
-- 2. Bloqueo de escrituras
-- ---------------------------------------------------------------------------
create or replace function public.empresa_suspendida(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status::text = 'suspended' from public.companies where id = p_company), false);
$$;

revoke all on function public.empresa_suspendida(uuid) from public, anon;
grant execute on function public.empresa_suspendida(uuid) to authenticated, service_role;

create or replace function public.bloquear_si_empresa_suspendida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  -- Sin usuario (crons, Edge Functions con service_role, SQL del panel) no se
  -- bloquea; el super admin tampoco.
  if auth.uid() is null or public.is_platform_super_admin() then
    return coalesce(new, old);
  end if;
  v_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  if public.empresa_suspendida(v_company) then
    raise exception 'La cuenta de esta empresa está suspendida. Para reactivarla, comuníquese con soporte de SellAlleS.'
      using errcode = 'P0001', hint = 'empresa_suspendida';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.bloquear_si_empresa_suspendida() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sales', 'credit_notes', 'credit_payments', 'caja_sessions', 'caja_movements',
    'customers', 'products', 'product_presentations', 'product_categories',
    'expenses', 'loans', 'loan_payments', 'loan_installments', 'financing_installments',
    'refinancings', 'quotes', 'quote_items', 'suppliers', 'supplier_invoices',
    'supplier_invoice_items', 'supplier_payments', 'product_transfers',
    'product_transfer_batches', 'services', 'coupons'
  ] loop
    execute format('drop trigger if exists trg_bloquear_empresa_suspendida on public.%I', t);
    execute format(
      'create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.%I '
      'for each row execute function public.bloquear_si_empresa_suspendida()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Recordatorios de cuotas: no a nombre de una empresa suspendida
-- ---------------------------------------------------------------------------
-- Igual a la versión viva (md5 f34c3ad4c47d0612cd2e5c693a96b8b6) más la
-- condición sobre c.status en las dos ramas.
CREATE OR REPLACE FUNCTION public.pending_due_reminders(p_days_ahead integer DEFAULT 3)
 RETURNS TABLE(kind text, installment_id uuid, company_name text, customer_name text, customer_email text, due_date date, amount_due numeric, late_fee numeric, is_overdue boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'loan'::text,
         li.id,
         c.name,
         cu.name,
         cu.email,
         li.due_date,
         round(li.amount - li.paid_amount, 2),
         public.late_fee_due(li.amount, li.paid_amount, li.late_fee_paid, li.due_date,
                             public.company_today(l.company_id),
                             coalesce(l.late_fee_rate, c.loan_late_fee_rate, 5),
                             coalesce(nullif(l.late_fee_mode, ''), 'once'),
                             coalesce(l.late_fee_grace_days, c.loan_late_fee_grace_days, 0),
                             coalesce(l.late_fee_max_rate, 0),
                             public.late_fee_period_days(l.payment_frequency)),
         li.due_date < public.company_today(l.company_id)
    from loan_installments li
    join loans l     on l.id = li.loan_id
    join companies c on c.id = l.company_id
    join customers cu on cu.id = l.customer_id
   where li.reminder_sent_at is null
     and li.status <> 'paid'
     and c.status::text <> 'suspended'
     and li.due_date <= public.company_today(l.company_id) + greatest(coalesce(p_days_ahead, 3), 0)
     and cu.email is not null and btrim(cu.email) <> ''

  union all

  select 'sale'::text,
         fi.id,
         c.name,
         cu.name,
         cu.email,
         fi.due_date,
         round(fi.amount - fi.paid_amount, 2),
         public.late_fee_due(fi.amount, fi.paid_amount, fi.late_fee_paid, fi.due_date,
                             public.company_today(s.company_id),
                             p.rate, p.fee_mode, p.grace_days, p.max_rate, p.period_days),
         fi.due_date < public.company_today(s.company_id)
    from financing_installments fi
    join sales s     on s.id = fi.sale_id
    join companies c on c.id = s.company_id
    join customers cu on cu.id = s.customer_id
    cross join lateral public.late_fee_policy(s.financing_details, c.late_fee_rate, c.late_fee_grace_days) p
   where fi.reminder_sent_at is null
     and fi.status <> 'paid'
     and s.cancelled_at is null
     and c.status::text <> 'suspended'
     and fi.due_date <= public.company_today(s.company_id) + greatest(coalesce(p_days_ahead, 3), 0)
     and cu.email is not null and btrim(cu.email) <> '';
$function$;

-- ---------------------------------------------------------------------------
-- 4. Suspender y reactivar
-- ---------------------------------------------------------------------------
create or replace function public.suspender_empresa(p_company uuid, p_motivo text, p_avisar boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.companies%rowtype;
  d record;
begin
  if not public.is_platform_super_admin() then
    raise exception 'Solo el administrador de la plataforma puede suspender una empresa.';
  end if;
  if p_motivo not in ('falta_de_pago', 'solicitud_cliente', 'revision') then
    raise exception 'Motivo de suspensión no válido: %', p_motivo;
  end if;

  select * into c from public.companies where id = p_company for update;
  if not found then
    raise exception 'La empresa no existe.';
  end if;
  if c.status::text = 'suspended' then
    raise exception 'La empresa ya está suspendida.';
  end if;

  update public.companies
     set status = 'suspended', suspension_reason = p_motivo
   where id = p_company
  returning * into c;

  if p_avisar then
    select * into d from public._contacto_de_cobro(p_company);
    if d.email is not null then
      perform public._enviar_correo_plataforma(
        'cuenta-suspendida', d.email, p_company,
        p_company::text || ':suspendida:' || extract(epoch from c.suspended_at)::bigint::text,
        jsonb_build_object(
          'companyName', c.name, 'userName', d.user_name, 'motivo', p_motivo,
          'bankAccounts', case when p_motivo = 'falta_de_pago' then public._cuentas_bancarias_json() end));
    end if;
  end if;
end;
$$;

create or replace function public.reactivar_empresa(
  p_company uuid,
  p_estado text,
  p_prueba_hasta date default null,
  p_solo_facturacion boolean default false,
  p_avisar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.companies%rowtype;
  d record;
  v_tz text;
begin
  if not public.is_platform_super_admin() then
    raise exception 'Solo el administrador de la plataforma puede reactivar una empresa.';
  end if;
  if p_estado not in ('trial', 'active') then
    raise exception 'Estado no válido al reactivar: %', p_estado;
  end if;
  if p_estado = 'trial' and p_prueba_hasta is null then
    raise exception 'Indique hasta cuándo va la prueba.';
  end if;

  select * into c from public.companies where id = p_company for update;
  if not found then
    raise exception 'La empresa no existe.';
  end if;
  if c.status::text <> 'suspended' then
    raise exception 'La empresa no está suspendida.';
  end if;
  v_tz := coalesce(nullif(btrim(c.timezone), ''), 'America/Santo_Domingo');

  if p_estado = 'trial' then
    -- La prueba vale hasta el final de ese día en la zona de la empresa, igual
    -- que cuando se edita en el formulario. Si la fecha ya pasó, la empresa
    -- entra en modo solo facturación (prueba vencida).
    update public.companies
       set status = 'trial',
           trial_ends_at = ((p_prueba_hasta + 1)::timestamp at time zone v_tz) - interval '1 second',
           solo_ventas = false,
           solo_ventas_desde = null
     where id = p_company
    returning * into c;
  else
    update public.companies
       set status = 'active',
           solo_ventas = coalesce(p_solo_facturacion, false),
           solo_ventas_desde = case when coalesce(p_solo_facturacion, false) then now() end
     where id = p_company
    returning * into c;
  end if;

  if p_avisar then
    select * into d from public._contacto_de_cobro(p_company);
    if d.email is not null then
      perform public._enviar_correo_plataforma(
        'cuenta-reactivada', d.email, p_company,
        p_company::text || ':reactivada:' || extract(epoch from now())::bigint::text,
        jsonb_build_object(
          'companyName', c.name, 'userName', d.user_name, 'estado', p_estado,
          'trialEndsAt', case when p_estado = 'trial' then c.trial_ends_at end,
          'soloFacturacion', p_estado = 'active' and coalesce(p_solo_facturacion, false),
          'bankAccounts', case when p_estado = 'active' and coalesce(p_solo_facturacion, false)
                               then public._cuentas_bancarias_json() end));
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A quién le llegaría el aviso
-- ---------------------------------------------------------------------------
create or replace function public.correo_admin_de_empresa(p_company uuid)
returns table (email text, user_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_super_admin() then
    raise exception 'Solo el administrador de la plataforma.';
  end if;
  return query select d.email, d.user_name from public._contacto_de_cobro(p_company) d;
end;
$$;

revoke all on function public.suspender_empresa(uuid, text, boolean) from public, anon;
revoke all on function public.reactivar_empresa(uuid, text, date, boolean, boolean) from public, anon;
revoke all on function public.correo_admin_de_empresa(uuid) from public, anon;
grant execute on function public.suspender_empresa(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.reactivar_empresa(uuid, text, date, boolean, boolean) to authenticated, service_role;
grant execute on function public.correo_admin_de_empresa(uuid) to authenticated, service_role;
