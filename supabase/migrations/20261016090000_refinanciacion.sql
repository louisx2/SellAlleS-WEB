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
