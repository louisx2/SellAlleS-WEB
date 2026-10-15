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

-- ---------------------------------------------------------------------------
-- 4. Refinanciar un financiamiento (en la misma venta)
-- ---------------------------------------------------------------------------
-- Calendario que empieza en otro número: las cuotas nuevas siguen a las que
-- se conservaron del plan anterior. La cuota j del plan cae igual que en la
-- versión de 8 argumentos; la última absorbe el redondeo.
create or replace function public.build_financing_schedule(
  p_company_id uuid, p_sale_id uuid, p_start date, p_freq text, p_n integer,
  p_installment numeric, p_debt numeric, p_first_due date, p_first_number integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  j        int;
  v_amount numeric;
begin
  for j in 1..p_n loop
    v_amount := case when j < p_n then p_installment
                     else p_debt - p_installment * (p_n - 1) end;

    insert into financing_installments (company_id, sale_id, installment_number, due_date, amount)
    values (p_company_id, p_sale_id, p_first_number + j - 1,
            financing_schedule_due_date(p_start, p_first_due, p_freq, j), v_amount);
  end loop;
end;
$function$;

revoke all on function public.build_financing_schedule(uuid, uuid, date, text, integer, numeric, numeric, date, integer) from public;
revoke execute on function public.build_financing_schedule(uuid, uuid, date, text, integer, numeric, numeric, date, integer) from anon, authenticated;

-- La venta sigue siendo la misma: lo pagado se queda, lo pendiente pasa a un
-- plan nuevo que arranca hoy. financing_details describe el plan vigente
-- (tasa, cuotas, principal, firstInstallment) y totalWithInterest sigue siendo
-- el de toda la vida de la venta, así que el balance del cliente y el reporte
-- de ganancia cuadran sin tocarlos.
create or replace function public.refinance_financing(
  p_sale_id uuid, p_base_mode text, p_late_fee_action text,
  p_interest_rate numeric, p_installments integer, p_frequency text, p_interest_mode text,
  p_first_due date, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_q         jsonb;
  v_today     date;
  v_late      numeric;
  v_action    text;
  v_principal numeric;
  v_plan      jsonb;
  v_before    jsonb;
  v_first     int;
  v_fd        jsonb;
  v_user_name text;
  v_ref_id    uuid;
  v_balance   numeric;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede refinanciar.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la refinanciación.';
  end if;
  if p_base_mode is null or p_base_mode not in ('capital', 'balance') then
    raise exception 'La base de la refinanciación no es válida.';
  end if;
  perform validate_financing_params(p_interest_rate, p_installments, p_frequency, p_interest_mode);

  v_q     := refinance_quote_data('financing', p_sale_id);
  v_today := (v_q->>'today')::date;

  if p_first_due is not null and p_first_due <= v_today then
    raise exception 'La primera cuota tiene que caer después de hoy.';
  end if;
  if (v_q->>'pending_balance')::numeric <= 0 then
    raise exception 'Este financiamiento no tiene saldo pendiente.';
  end if;

  v_late := (v_q->>'late_fee_due')::numeric;
  if v_late > 0 then
    if p_late_fee_action is null or p_late_fee_action not in ('capitalize', 'forgive') then
      raise exception 'Hay mora pendiente: indica si se suma al capital o se perdona.';
    end if;
    v_action := p_late_fee_action;
  end if;

  v_principal := case p_base_mode
                   when 'capital' then (v_q->>'pending_capital')::numeric
                   else (v_q->>'pending_balance')::numeric
                 end
                 + case when v_action = 'capitalize' then v_late else 0 end;

  v_plan := financing_plan(v_principal, p_interest_rate, p_installments, p_frequency, p_interest_mode);

  v_before := jsonb_build_object(
    'details', v_sale.financing_details,
    'installments', (select coalesce(jsonb_agg(to_jsonb(fi) order by fi.installment_number), '[]'::jsonb)
                       from financing_installments fi where fi.sale_id = p_sale_id));

  -- Cierre del plan vigente: una cuota con algo pagado (capital o solo mora)
  -- se queda con lo que se pagó; las que no tienen nada, salen.
  update financing_installments
     set amount = paid_amount, status = 'paid', paid_at = coalesce(paid_at, now())
   where sale_id = p_sale_id and status <> 'paid' and (paid_amount > 0 or late_fee_paid > 0);
  delete from financing_installments
   where sale_id = p_sale_id and status <> 'paid';

  select coalesce(max(installment_number), 0) + 1 into v_first
    from financing_installments where sale_id = p_sale_id;

  perform build_financing_schedule(
    v_sale.company_id, v_sale.id, v_today, p_frequency, p_installments,
    (v_plan->>'installment')::numeric, (v_plan->>'debt')::numeric, p_first_due, v_first);

  v_fd := (v_sale.financing_details - 'firstDueDate') || jsonb_build_object(
    'interestRate',      p_interest_rate,
    'interestMode',      p_interest_mode,
    'frequency',         p_frequency,
    'installments',      p_installments,
    'installmentAmount', (v_plan->>'installment')::numeric,
    'totalWithInterest', v_sale.amount_paid + (v_plan->>'debt')::numeric,
    'principal',         v_principal,
    'firstInstallment',  v_first,
    'refinancedAt',      now(),
    'lateFeeRate',       (v_q->'new_late_fee'->>'rate')::numeric,
    'lateFeeMode',       v_q->'new_late_fee'->>'mode',
    'lateFeeGraceDays',  (v_q->'new_late_fee'->>'graceDays')::int,
    'lateFeeMaxRate',    (v_q->'new_late_fee'->>'maxRate')::numeric);
  if p_first_due is not null then
    v_fd := v_fd || jsonb_build_object('firstDueDate', p_first_due);
  end if;

  update sales set financing_details = v_fd where id = p_sale_id;

  select name into v_user_name from profiles where id = auth.uid();

  insert into refinancings
    (company_id, customer_id, kind, sale_id, base_mode, pending_balance, pending_capital,
     unearned_interest, late_fee_amount, late_fee_action, new_principal,
     plan_before, plan_after, reason, created_by, created_by_name)
  values
    (v_sale.company_id, v_sale.customer_id, 'financing', v_sale.id, p_base_mode,
     (v_q->>'pending_balance')::numeric, (v_q->>'pending_capital')::numeric,
     (v_q->>'unearned_interest')::numeric, v_late, v_action, v_principal,
     v_before,
     jsonb_build_object(
       'details', v_fd,
       'installments', (select coalesce(jsonb_agg(to_jsonb(fi) order by fi.installment_number), '[]'::jsonb)
                          from financing_installments fi
                         where fi.sale_id = p_sale_id and fi.installment_number >= v_first)),
     btrim(p_reason), auth.uid(), v_user_name)
  returning id into v_ref_id;

  v_balance := recompute_customer_balance(v_sale.customer_id);

  return jsonb_build_object(
    'sale_id',             v_sale.id,
    'refinancing_id',      v_ref_id,
    'new_principal',       v_principal,
    'interest',            (v_plan->>'interest')::numeric,
    'total_with_interest', v_sale.amount_paid + (v_plan->>'debt')::numeric,
    'installment_amount',  (v_plan->>'installment')::numeric,
    'first_installment',   v_first,
    'customer_balance',    v_balance
  );
end;
$function$;

revoke all on function public.refinance_financing(uuid, text, text, numeric, integer, text, text, date, text) from public;
revoke execute on function public.refinance_financing(uuid, text, text, numeric, integer, text, text, date, text) from anon;
grant execute on function public.refinance_financing(uuid, text, text, numeric, integer, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lo que una refinanciación cierra
-- ---------------------------------------------------------------------------
-- amend_sale_financing: la definición viva (la de 20261014233000) más el
-- bloqueo. Corregir rearma el calendario desde la fecha de la venta y recalcula
-- sobre total − abono inicial: desharía la refinanciación.
create or replace function public.amend_sale_financing(p_sale_id uuid, p_interest_rate numeric, p_installments integer, p_frequency text, p_interest_mode text, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_customer  customers%rowtype;
  v_before    jsonb;
  v_after     jsonb;
  v_plan      jsonb;
  v_freq      text;
  v_mode      text;
  v_rate      numeric;
  v_n         int;
  v_start     date;
  v_first     date;
  v_old_dates date[];
  v_paid      numeric;
  v_other     numeric;
  v_balance   numeric;
  v_user_name text;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede corregir un plan de financiamiento.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la corrección.';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta está anulada.';
  end if;
  if v_sale.payment_status <> 'in_financing' or v_sale.financing_details is null then
    raise exception 'Esta venta no tiene un plan de financiamiento que corregir.';
  end if;
  if v_sale.financing_details ? 'refinancedAt' then
    raise exception 'Este financiamiento fue refinanciado: ya no se puede corregir el plan.';
  end if;

  -- El límite: repreciar mueve el monto de TODAS las cuotas, así que un peso ya
  -- aplicado dejaría el plan sin forma de cuadrar con lo que el cliente pagó.
  -- Anular los abonos primero es una operación que ya existe y deja su rastro.
  select coalesce(sum(paid_amount + late_fee_paid), 0) into v_paid
    from financing_installments where sale_id = p_sale_id;
  if v_paid > 0 then
    raise exception 'Este financiamiento ya tiene cuotas cobradas: anula esos abonos antes de corregir el plan.';
  end if;

  v_rate := p_interest_rate;
  v_n    := p_installments;
  v_freq := coalesce(nullif(btrim(coalesce(p_frequency, '')), ''),
                     nullif(v_sale.financing_details->>'frequency', ''), 'monthly');
  v_mode := coalesce(nullif(btrim(coalesce(p_interest_mode, '')), ''),
                     nullif(v_sale.financing_details->>'interestMode', ''), 'monthly_prorated');

  perform validate_financing_params(v_rate, v_n, v_freq, v_mode);

  v_before := v_sale.financing_details;

  -- Mismo cálculo que la venta original: el capital es lo que quedó debiendo
  -- después del abono inicial, que no se toca aquí (para cambiarlo hay que
  -- anular la venta).
  v_plan := financing_plan(v_sale.total - v_sale.amount_paid, v_rate, v_n, v_freq, v_mode);

  -- La mora y los días de gracia siguen congelados como el día de la venta:
  -- esto corrige un error de digitación, no reabre los términos del contrato.
  v_after := v_before || jsonb_build_object(
    'interestRate',      v_rate,
    'interestMode',      v_mode,
    'frequency',         v_freq,
    'installments',      v_n,
    'installmentAmount', (v_plan->>'installment')::numeric,
    'totalWithInterest', (v_plan->>'debt')::numeric + v_sale.amount_paid,
    'downPayment',       v_sale.amount_paid
  );

  if v_after = v_before then
    raise exception 'El plan quedaría igual que antes: no hay nada que corregir.';
  end if;

  -- El límite de crédito se valida igual que al vender, pero contra el balance
  -- SIN esta venta: si no, la deuda vieja se contaría dos veces.
  select * into v_customer from customers where id = v_sale.customer_id for update;
  if found and v_customer.credit_limit is not null then
    select coalesce(sum(
             case when payment_status = 'in_financing'
                  then coalesce((financing_details->>'totalWithInterest')::numeric, total) - amount_paid
                  else total - amount_paid end), 0)
      into v_other
      from sales
     where customer_id = v_sale.customer_id
       and payment_status in ('credit','in_financing')
       and cancelled_at is null
       and id <> p_sale_id;

    if v_other + (v_plan->>'debt')::numeric > v_customer.credit_limit then
      raise exception 'Límite de crédito excedido: disponible RD$%, deuda corregida RD$%.',
        to_char(greatest(v_customer.credit_limit - v_other, 0), 'FM999,999,990.00'),
        to_char((v_plan->>'debt')::numeric, 'FM999,999,990.00');
    end if;
  end if;

  update sales set financing_details = v_after where id = p_sale_id;

  -- El calendario arranca el día de la VENTA, no el de hoy: corregir la tasa
  -- no debe correrle los vencimientos al cliente. Por lo mismo, si la cuota 1
  -- no cae donde caería por defecto (se eligió el primer pago al vender o se
  -- reprogramó después), el plan corregido arranca en esa misma fecha. Se
  -- compara con la frecuencia VIEJA, que es la que armó el calendario actual.
  v_start := sale_local_date(v_sale.company_id, v_sale.created_at);

  select due_date into v_first
    from financing_installments
   where sale_id = p_sale_id and installment_number = 1;
  if v_first = financing_due_date(v_start, coalesce(nullif(v_before->>'frequency', ''), 'monthly'), 1) then
    v_first := null;
  end if;

  select array_agg(due_date order by installment_number) into v_old_dates
    from financing_installments where sale_id = p_sale_id;

  -- Las cuotas se regeneran completas porque la cantidad puede cambiar. Es
  -- seguro justo por el chequeo de arriba: ninguna trae dinero aplicado.
  delete from financing_installments where sale_id = p_sale_id;

  perform build_financing_schedule(
    v_sale.company_id, v_sale.id, v_start, v_freq, v_n,
    (v_plan->>'installment')::numeric, (v_plan->>'debt')::numeric, v_first
  );

  -- Con la misma cantidad de cuotas y la misma frecuencia, cada cuota vuelve a
  -- su fecha de antes: corregir la tasa no deshace una prórroga dada a una
  -- cuota suelta. Si cambia la cantidad o la frecuencia, el calendario se
  -- rearma desde el primer pago, que es lo único que se puede conservar.
  if v_n = cardinality(v_old_dates)
     and v_freq = coalesce(nullif(v_before->>'frequency', ''), 'monthly') then
    update financing_installments fi
       set due_date = v_old_dates[fi.installment_number]
     where fi.sale_id = p_sale_id;
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into financing_amendments
    (company_id, sale_id, reason, details_before, details_after, changed_by, changed_by_name)
  values
    (v_sale.company_id, v_sale.id, btrim(p_reason), v_before, v_after, auth.uid(), v_user_name);

  v_balance := recompute_customer_balance(v_sale.customer_id);

  return jsonb_build_object(
    'sale_id',          v_sale.id,
    'before',           v_before,
    'after',            v_after,
    'interest_before',  coalesce((v_before->>'totalWithInterest')::numeric, v_sale.total) - v_sale.total,
    'interest_after',   (v_plan->>'interest')::numeric,
    'customer_balance', v_balance
  );
end;
$function$;

-- void_credit_payment: la definición viva más el bloqueo. Un abono que pagó
-- cuotas de un plan que después se refinanció no se puede revertir: esas
-- cuotas quedaron cerradas con lo pagado y el plan nuevo se armó sobre ese
-- saldo. Se decide por número de cuota (anteriores a firstInstallment) y no
-- por fecha, que dentro de una misma transacción no distingue antes y después.
create or replace function public.void_credit_payment(p_payment_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_p          credit_payments%rowtype;
  v_sale_ent   jsonb;
  v_inst_ent   jsonb;
  v_sale       sales%rowtype;
  v_principal  numeric;
  v_user_name  text;
  v_session    caja_sessions%rowtype;
  v_balance    numeric;
  v_cash_out   boolean := false;
begin
  select * into v_p from credit_payments where id = p_payment_id for update;
  if not found or (v_p.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Abono no encontrado.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular un abono.';
  end if;
  if v_p.voided_at is not null then
    raise exception 'Este abono ya fue anulado.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la anulación.';
  end if;
  if v_p.kind = 'down_payment' then
    raise exception 'El abono inicial es parte de la venta: para revertirlo hay que anular la venta completa.';
  end if;
  if v_p.allocation is null then
    raise exception 'Este abono es anterior al registro de aplicación por cuota, así que no se puede revertir automáticamente. Corrígelo desde la base con respaldo.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_p.allocation->'sales') se
      join sales s on s.id = (se->>'sale_id')::uuid
      cross join lateral jsonb_array_elements(coalesce(se->'installments', '[]'::jsonb)) ie
      join financing_installments fi on fi.id = (ie->>'id')::uuid
     where s.financing_details ? 'firstInstallment'
       and fi.installment_number < (s.financing_details->>'firstInstallment')::int
  ) then
    raise exception 'Este abono es anterior a una refinanciación: no se puede anular.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  -- El efectivo tiene que salir de una caja abierta. Si el abono se cobró
  -- dentro de la sesión que sigue abierta, basta con excluirlo del cierre
  -- (`close_caja_session` ya ignora los anulados); si fue en una sesión
  -- anterior, esa ya cerró con el dinero contado y hay que sacarlo ahora.
  if v_p.method = 'cash'
     and is_module_enabled(v_p.company_id, 'caja', false)
     and v_p.branch_id is not null
     and branch_uses_caja(v_p.branch_id) then
    select * into v_session from caja_sessions
     where branch_id = v_p.branch_id and status = 'open' for update;
    if not found then
      raise exception 'Abre la caja de esta sucursal antes de anular un abono cobrado en efectivo.';
    end if;
    v_cash_out := (v_session.opened_at > v_p.date);
  end if;

  for v_sale_ent in select * from jsonb_array_elements(v_p.allocation->'sales')
  loop
    v_principal := coalesce((v_sale_ent->>'principal')::numeric, 0);

    select * into v_sale from sales where id = (v_sale_ent->>'sale_id')::uuid for update;
    if found then
      update sales
         set amount_paid = greatest(round(amount_paid - v_principal, 2), 0),
             payment_status = case
               when greatest(amount_paid - v_principal, 0) >=
                    case when sale_is_financed(financing_details)
                         then coalesce((financing_details->>'totalWithInterest')::numeric, total)
                         else total end - 0.01
                 then 'paid'::payment_status
               when sale_is_financed(financing_details) then 'in_financing'::payment_status
               else 'credit'::payment_status
             end
       where id = v_sale.id;
    end if;

    for v_inst_ent in select * from jsonb_array_elements(v_sale_ent->'installments')
    loop
      update financing_installments fi
         set paid_amount   = greatest(round(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 2), 0),
             late_fee_paid = greatest(round(fi.late_fee_paid - coalesce((v_inst_ent->>'late_fee')::numeric, 0), 2), 0),
             status = case
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= fi.amount - 0.005 then 'paid'
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) <= 0.005 then 'pending'
               else 'partial' end,
             paid_at = case
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= fi.amount - 0.005 then fi.paid_at
               else null end
       where fi.id = (v_inst_ent->>'id')::uuid;
    end loop;
  end loop;

  update credit_payments
     set voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_user_name, void_reason = btrim(p_reason)
   where id = p_payment_id;

  if v_cash_out then
    insert into caja_movements
      (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
    values
      (v_session.id, v_p.company_id, v_p.branch_id, 'out', v_p.amount,
       'Anulación de abono del ' || to_char(v_p.date, 'DD/MM/YYYY') || ': ' || btrim(p_reason),
       auth.uid(), v_user_name);
  end if;

  v_balance := recompute_customer_balance(v_p.customer_id);

  return jsonb_build_object(
    'payment_id',       v_p.id,
    'amount',           v_p.amount,
    'cash_returned',    v_cash_out,
    'customer_balance', v_balance
  );
end;
$function$;

-- reschedule_financing_installments: la definición viva (20261014232346) con
-- el chequeo de orden limitado al plan vigente. Las cuotas que cerró una
-- refinanciación conservan su fecha original, y si el cliente las pagó por
-- adelantado vencen después que las nuevas: compararlas haría imposible mover
-- ninguna cuota del plan nuevo. Las cerradas están pagadas, así que no se
-- pueden mover de todos modos.
create or replace function public.reschedule_financing_installments(p_sale_id uuid, p_installment_number integer, p_new_date date, p_shift_following boolean default true, p_reason text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_target    financing_installments%rowtype;
  v_freq      text;
  v_start     date;
  v_new       date;
  v_prev_due  date;
  v_prev_num  int;
  v_changes   jsonb := '[]'::jsonb;
  v_user_name text;
  r           record;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  -- SECURITY DEFINER: salta RLS para escribir las cuotas, así que el permiso
  -- se valida aquí. Mismo criterio que anular abonos o corregir el plan.
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede cambiar las fechas de pago.';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta está anulada.';
  end if;
  if p_new_date is null then
    raise exception 'Indica la nueva fecha.';
  end if;

  -- Bloquea el plan completo: un abono que entre a la vez no puede pagar una
  -- cuota entre que se valida y se mueve.
  perform 1 from financing_installments where sale_id = p_sale_id for update;

  select * into v_target
    from financing_installments
   where sale_id = p_sale_id and installment_number = p_installment_number;
  if not found then
    raise exception 'Esa cuota no existe en este financiamiento.';
  end if;
  if v_target.status = 'paid' then
    raise exception 'La cuota % ya está pagada: no se puede mover.', p_installment_number;
  end if;

  v_start := sale_local_date(v_sale.company_id, v_sale.created_at);
  if p_new_date < v_start then
    raise exception 'La cuota no puede vencer antes de la venta (%).', to_char(v_start, 'DD/MM/YYYY');
  end if;

  v_freq := coalesce(nullif(v_sale.financing_details->>'frequency', ''), 'monthly');

  -- Las siguientes se cuentan desde la fecha nueva (no se corren N días), así
  -- una mensual movida al 31 sigue cayendo a fin de mes. Las pagadas no se
  -- tocan; por el orden en que se aplican los abonos no debería haber una
  -- pagada después de una pendiente, pero si la hay, el chequeo de orden la
  -- defiende.
  for r in
    select id, installment_number, due_date, status
      from financing_installments
     where sale_id = p_sale_id
       and installment_number >= coalesce((v_sale.financing_details->>'firstInstallment')::int, 1)
     order by installment_number
  loop
    v_new := case
      when r.installment_number = p_installment_number then p_new_date
      when p_shift_following and r.installment_number > p_installment_number and r.status <> 'paid'
        then financing_due_date(p_new_date, v_freq, r.installment_number - p_installment_number)
      else r.due_date
    end;

    if v_prev_due is not null and v_new <= v_prev_due then
      raise exception 'Las fechas tienen que quedar en orden: la cuota % tiene que vencer después de la cuota % (%).',
        r.installment_number, v_prev_num, to_char(v_prev_due, 'DD/MM/YYYY');
    end if;

    if v_new <> r.due_date then
      -- El recordatorio era para la fecha vieja: que vuelva a salir para la nueva.
      update financing_installments
         set due_date = v_new, reminder_sent_at = null
       where id = r.id;
      v_changes := v_changes || jsonb_build_object(
        'installment', r.installment_number, 'before', r.due_date, 'after', v_new);
    end if;

    v_prev_due := v_new;
    v_prev_num := r.installment_number;
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    raise exception 'Las fechas quedarían iguales: no hay nada que cambiar.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into financing_schedule_changes
    (company_id, sale_id, reason, changes, changed_by, changed_by_name)
  values
    (v_sale.company_id, v_sale.id, nullif(btrim(coalesce(p_reason, '')), ''), v_changes,
     auth.uid(), v_user_name);

  return jsonb_build_object('sale_id', v_sale.id, 'changes', v_changes);
end;
$function$;
