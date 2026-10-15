-- Refinanciación de préstamos y financiamientos.
-- Diseño: docs/superpowers/specs/2026-10-15-refinanciacion-design.md (repo raíz).
--
-- Un financiamiento se rehace dentro de la misma venta: las cuotas pagadas se
-- quedan, las pendientes se reemplazan por el plan nuevo. Un préstamo se cierra
-- como 'refinanced' y se abre otro enlazado (que puede llevar dinero adicional).
-- El admin elige la base (solo capital pendiente o saldo completo) y si la mora
-- se suma o se perdona. Todo queda en `refinancings`.

-- ---------------------------------------------------------------------------
-- 1. Historial
-- ---------------------------------------------------------------------------
create table if not exists public.refinancings (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  customer_id       uuid not null references public.customers(id),
  kind              text not null check (kind in ('loan', 'financing')),
  loan_id           uuid references public.loans(id),
  new_loan_id       uuid references public.loans(id),
  sale_id           uuid references public.sales(id),
  base_mode         text not null check (base_mode in ('capital', 'balance')),
  pending_balance   numeric(12,2) not null default 0,
  pending_capital   numeric(12,2) not null default 0,
  unearned_interest numeric(12,2) not null default 0,
  late_fee_amount   numeric(12,2) not null default 0,
  late_fee_action   text check (late_fee_action in ('capitalize', 'forgive')),
  additional_amount numeric(12,2) not null default 0,
  new_principal     numeric(12,2) not null,
  plan_before       jsonb,
  plan_after        jsonb,
  reason            text not null,
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  -- Un préstamo viejo apunta a su reemplazo; un financiamiento, a su venta.
  constraint refinancings_kind_ids check (
    (kind = 'loan' and loan_id is not null and new_loan_id is not null and sale_id is null)
    or (kind = 'financing' and sale_id is not null and loan_id is null and new_loan_id is null)
  )
);

create index if not exists refinancings_sale_id_idx     on public.refinancings (sale_id);
create index if not exists refinancings_loan_id_idx     on public.refinancings (loan_id);
create index if not exists refinancings_new_loan_id_idx on public.refinancings (new_loan_id);
create index if not exists refinancings_company_id_idx  on public.refinancings (company_id);

comment on table public.refinancings is
  'Cada refinanciación de un préstamo o financiamiento. La escriben solo refinance_loan y refinance_financing.';

alter table public.refinancings enable row level security;

drop policy if exists refinancings_select on public.refinancings;
create policy refinancings_select on public.refinancings
  for select
  using (((company_id = current_company_id()) and is_company_admin()) or is_super_admin());

revoke all on public.refinancings from anon, authenticated;
grant select on public.refinancings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Préstamos: estado refinanciado, enlace al viejo y primera cuota elegible
-- ---------------------------------------------------------------------------
alter table public.loans drop constraint if exists loans_status_check;
alter table public.loans add constraint loans_status_check
  check (status = any (array['active'::text, 'paid'::text, 'cancelled'::text, 'refinanced'::text]));

alter table public.loans add column if not exists refinanced_from_id uuid references public.loans(id);
alter table public.loans add column if not exists carried_over_amount numeric(12,2) not null default 0;
alter table public.loans add column if not exists first_due_date date;

create index if not exists loans_refinanced_from_id_idx on public.loans (refinanced_from_id);

comment on column public.loans.refinanced_from_id is
  'Préstamo que este refinancia. El viejo queda en status refinanced.';
comment on column public.loans.carried_over_amount is
  'Parte del capital que viene del préstamo refinanciado (saldo + mora sumada). principal - esto = dinero nuevo entregado.';
comment on column public.loans.first_due_date is
  'Fecha de la cuota 1 si se eligió; las demás siguen la frecuencia. Null = un período después del desembolso, como siempre.';

-- Mismo calendario de siempre, salvo que ahora la cuota 1 puede caer en
-- first_due_date. financing_schedule_due_date con first_due null da exactamente
-- el case que había (financing_due_date usa las mismas fórmulas).
create or replace function public.trg_after_loan_effects()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n      int := new.installments_count;
  v_cuota  numeric;
  v_debt   numeric;
  v_amount numeric;
  v_due    date;
  k        int;
begin
  v_debt  := new.total_with_interest;
  v_cuota := round(v_debt / v_n, 2);

  for k in 1..v_n loop
    if k < v_n then
      v_amount := v_cuota;
    else
      v_amount := v_debt - v_cuota * (v_n - 1);
    end if;

    v_due := financing_schedule_due_date(new.created_at::date, new.first_due_date, new.payment_frequency, k);

    insert into public.loan_installments (company_id, loan_id, installment_number, due_date, amount)
    values (new.company_id, new.id, k, v_due, v_amount);
  end loop;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Cotización: lo que se debe hoy, separado en capital, interés futuro y mora
-- ---------------------------------------------------------------------------
-- El interés es add-on: cada cuota lleva capital e interés en la misma
-- proporción, así que el capital pendiente es capital_del_plan × saldo ÷
-- deuda_del_plan. "Plan" es el vigente: en un financiamiento ya refinanciado,
-- las cuotas desde firstInstallment y el capital guardado en principal.
--
-- Interna: no revisa permisos. La usan refinance_quote (que sí los revisa) y
-- las dos RPC de refinanciar, dentro de su misma transacción y con las filas
-- ya bloqueadas.
create or replace function public.refinance_quote_data(p_kind text, p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_fd        jsonb;
  v_first     int;
  v_all_debt  numeric;
  v_principal numeric;
  v_debt      numeric;
  v_balance   numeric;
  v_capital   numeric;
  v_late      numeric;
  v_new_fee   jsonb;
begin
  if p_kind = 'financing' then
    select * into v_sale from sales where id = p_id for update;
    if not found
       or v_sale.cancelled_at is not null
       or v_sale.payment_status::text <> 'in_financing'
       or not sale_is_financed(v_sale.financing_details) then
      raise exception 'Esta venta no tiene un financiamiento que refinanciar.';
    end if;

    v_fd    := v_sale.financing_details;
    v_first := coalesce((v_fd->>'firstInstallment')::int, 1);

    perform 1 from financing_installments where sale_id = p_id for update;

    -- Capital del plan vigente. Un plan original no trae `principal`: es lo
    -- que quedó debiendo después del abono inicial. Todas las ventas abiertas
    -- traen downPayment (comprobado 2026-10-15); la otra vía es un respaldo.
    select coalesce(sum(amount), 0) into v_all_debt
      from financing_installments where sale_id = p_id;
    v_principal := coalesce(
      (v_fd->>'principal')::numeric,
      v_sale.total - coalesce((v_fd->>'downPayment')::numeric,
                              (v_fd->>'totalWithInterest')::numeric - v_all_debt));

    select coalesce(sum(amount), 0), coalesce(sum(amount - paid_amount), 0)
      into v_debt, v_balance
      from financing_installments
     where sale_id = p_id and installment_number >= v_first;

    v_balance := round(v_balance, 2);
    v_capital := case when v_debt > 0 then round(v_principal * v_balance / v_debt, 2) else 0 end;

    -- La misma suma que cobra apply_payment_to_sale.
    v_late := sale_late_fee_due(p_id);

    -- La mora del plan nuevo: los ajustes vigentes, sucursal antes que
    -- empresa, igual que before_sale_credit_checks al vender.
    select jsonb_build_object(
             'rate',      coalesce(b.late_fee_rate, c.late_fee_rate, 5),
             'mode',      coalesce(b.late_fee_mode, c.late_fee_mode, 'once'),
             'graceDays', coalesce(b.late_fee_grace_days, c.late_fee_grace_days, 0),
             'maxRate',   coalesce(b.late_fee_max_rate, c.late_fee_max_rate, 0))
      into v_new_fee
      from companies c
      left join branches b on b.id = v_sale.branch_id and b.company_id = c.id
     where c.id = v_sale.company_id;

    return jsonb_build_object(
      'kind',              'financing',
      'id',                v_sale.id,
      'company_id',        v_sale.company_id,
      'customer_id',       v_sale.customer_id,
      'pending_balance',   v_balance,
      'pending_capital',   v_capital,
      'unearned_interest', v_balance - v_capital,
      'late_fee_due',      v_late,
      'plan_principal',    v_principal,
      'plan_debt',         v_debt,
      'first_installment', v_first,
      'today',             company_today(v_sale.company_id),
      'terms', jsonb_build_object(
        'interestRate', coalesce((v_fd->>'interestRate')::numeric, 0),
        'installments', coalesce((v_fd->>'installments')::int, 1),
        'frequency',    coalesce(nullif(v_fd->>'frequency', ''), 'monthly'),
        'interestMode', coalesce(nullif(v_fd->>'interestMode', ''), 'monthly_prorated')),
      'new_late_fee', v_new_fee
    );
  end if;

  raise exception 'Tipo no soportado.';
end;
$function$;

revoke all on function public.refinance_quote_data(text, uuid) from public;
revoke execute on function public.refinance_quote_data(text, uuid) from anon, authenticated;

create or replace function public.refinance_quote(p_kind text, p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede refinanciar.';
  end if;

  if p_kind = 'financing' then
    select company_id into v_company from sales where id = p_id;
    if v_company is null or (v_company <> current_company_id() and not is_super_admin()) then
      raise exception 'Venta no encontrada.';
    end if;
  elsif p_kind = 'loan' then
    select company_id into v_company from loans where id = p_id;
    if v_company is null or (v_company <> current_company_id() and not is_super_admin()) then
      raise exception 'Préstamo no encontrado.';
    end if;
  else
    raise exception 'Tipo no soportado.';
  end if;

  return refinance_quote_data(p_kind, p_id);
end;
$function$;

revoke all on function public.refinance_quote(text, uuid) from public;
revoke execute on function public.refinance_quote(text, uuid) from anon;
grant execute on function public.refinance_quote(text, uuid) to authenticated;
