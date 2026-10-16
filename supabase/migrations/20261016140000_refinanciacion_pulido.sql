-- Refinanciación: tres detalles que quedaron de la revisión.
--
-- 1. El recibo de un abono a una venta refinanciada decía "cuota 5 de 16":
--    register_sale_payment contaba también las cuotas que cerró la
--    refinanciación. Ahora cuenta las del plan vigente.
-- 2. La primera cuota del plan nuevo de un financiamiento solo tenía que caer
--    después de hoy. Ahora, igual que al vender a plazos y que en préstamos,
--    también a no más de 90 días.
-- 3. La cotización de un financiamiento rechaza las ventas cuyas cuotas no
--    suman lo que la venta dice que se debe, en vez de refinanciar sobre esos
--    números (el 2026-10-16 las 24 ventas financiadas abiertas cuadraban).

-- Requisito: la migración de la refinanciación.
do $$
begin
  if to_regclass('public.refinancings') is null then
    raise exception 'Falta aplicar 20261016090000_refinanciacion.sql antes de esta migración.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. register_sale_payment: la definición viva (volcada el 2026-10-16) con el
--    conteo de cuotas limitado al plan vigente.
-- ---------------------------------------------------------------------------
create or replace function public.register_sale_payment(p_sale_id uuid, p_amount numeric, p_method text, p_branch_id uuid default null::uuid, p_notes text default null::text, p_reference text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale        sales%rowtype;
  v_total_due   numeric;
  v_late_due    numeric := 0;
  v_res         jsonb;
  v_payment_id  uuid;
  v_user_name   text;
  v_paid_count  int := 0;
  v_total_count int := 0;
  v_balance     numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada.';
  end if;

  -- La función salta RLS: el permiso se valida aquí, con el mismo criterio de
  -- la policy de `sales`.
  if not can_collect_sale(p_sale_id) then
    raise exception 'No tienes acceso a esta venta.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta está anulada.';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'Esta venta ya está saldada.';
  end if;
  if v_sale.payment_status not in ('credit','in_financing') then
    raise exception 'Esta venta no es a crédito ni financiada.';
  end if;

  -- La sucursal del cobro decide de qué caja sale/entra el dinero: tiene que
  -- ser de la misma empresa.
  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_sale.company_id;
    if not found then
      raise exception 'Sucursal no válida para esta venta.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_sale.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  if v_sale.payment_status = 'in_financing' then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;
    v_late_due  := sale_late_fee_due(p_sale_id);
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
  end if;

  if p_amount > v_total_due + v_late_due + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'),
      to_char(v_total_due + v_late_due, 'FM999,999,990.00');
  end if;

  v_res := apply_payment_to_sale(p_sale_id, p_amount);

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_payments
    (company_id, sale_id, customer_id, branch_id, amount, late_fee_paid, method,
     reference, notes, user_id, user_name, date, kind, allocation)
  values
    (v_sale.company_id, v_sale.id, v_sale.customer_id, p_branch_id, p_amount,
     (v_res->>'late_fee')::numeric, p_method, p_reference, p_notes,
     auth.uid(), v_user_name, now(), 'sale',
     jsonb_build_object('sales', jsonb_build_array(v_res)))
  returning id into v_payment_id;

  v_balance := recompute_customer_balance(v_sale.customer_id);

  -- "Cuota X de N" del plan vigente: tras una refinanciación, las cuotas del
  -- plan anterior (las que cerró) no cuentan.
  select count(*) filter (where status = 'paid'), count(*)
    into v_paid_count, v_total_count
    from financing_installments
   where sale_id = p_sale_id
     and installment_number >= coalesce((v_sale.financing_details->>'firstInstallment')::int, 1);

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             p_amount,
    'late_fee_paid',      (v_res->>'late_fee')::numeric,
    'principal_paid',     (v_res->>'principal')::numeric,
    'remaining_balance',  greatest(round(v_total_due - (v_res->>'principal')::numeric, 2), 0),
    'installments_paid',  v_paid_count,
    'installments_total', v_total_count,
    'customer_balance',   v_balance
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. refinance_quote_data: la de 20261016090000 con el chequeo de que las
--    cuotas del plan vigente cuadran con el saldo de la venta.
-- ---------------------------------------------------------------------------
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
  v_sale_due  numeric;
  v_capital   numeric;
  v_late      numeric;
  v_new_fee   jsonb;
  v_loan      loans%rowtype;
  v_rate      numeric;
  v_mode      text;
  v_grace     int;
  v_max_rate  numeric;
  v_today     date;
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

    -- Las cuotas del plan vigente tienen que sumar lo que la venta dice que se
    -- debe (lo mismo que cobra register_sale_payment). Si no, el capital y el
    -- interés por vencer saldrían de números que no son.
    v_sale_due := round(coalesce((v_fd->>'totalWithInterest')::numeric, v_sale.total) - v_sale.amount_paid, 2);
    if abs(v_balance - v_sale_due) > 0.01 then
      raise exception 'Las cuotas de esta venta no cuadran con su saldo: suman RD$% y la venta debe RD$%. Revísala antes de refinanciar.',
        to_char(v_balance, 'FM999,999,990.00'), to_char(v_sale_due, 'FM999,999,990.00');
    end if;

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

  if p_kind = 'loan' then
    select * into v_loan from loans where id = p_id for update;
    if not found or v_loan.status <> 'active' then
      raise exception 'Este préstamo no está activo.';
    end if;

    perform 1 from loan_installments where loan_id = p_id for update;

    -- La mora como la cobra register_loan_payment: la política congelada del
    -- préstamo, con la de la empresa para los anteriores a la mora
    -- configurable. La del préstamo nuevo: los ajustes vigentes, igual que
    -- trg_before_loan_checks al desembolsar.
    select coalesce(v_loan.late_fee_rate, c.loan_late_fee_rate, 5),
           coalesce(nullif(v_loan.late_fee_mode, ''), 'once'),
           coalesce(v_loan.late_fee_grace_days, c.loan_late_fee_grace_days, 0),
           coalesce(v_loan.late_fee_max_rate, 0),
           jsonb_build_object(
             'rate',      coalesce(c.loan_late_fee_rate, 5),
             'mode',      coalesce(c.loan_late_fee_mode, 'once'),
             'graceDays', coalesce(c.loan_late_fee_grace_days, 0),
             'maxRate',   coalesce(c.loan_late_fee_max_rate, 0))
      into v_rate, v_mode, v_grace, v_max_rate, v_new_fee
      from companies c where c.id = v_loan.company_id;

    v_today := company_today(v_loan.company_id);

    select coalesce(sum(late_fee_due(amount, paid_amount, late_fee_paid, due_date, v_today,
                                     v_rate, v_mode, v_grace, v_max_rate,
                                     late_fee_period_days(v_loan.payment_frequency))), 0)
      into v_late
      from loan_installments
     where loan_id = p_id and status <> 'paid';

    v_principal := v_loan.principal;
    v_debt      := v_loan.total_with_interest;
    v_balance   := round(v_loan.total_with_interest - v_loan.amount_paid, 2);
    v_capital   := case when v_debt > 0 then round(v_principal * v_balance / v_debt, 2) else 0 end;

    return jsonb_build_object(
      'kind',              'loan',
      'id',                v_loan.id,
      'company_id',        v_loan.company_id,
      'customer_id',       v_loan.customer_id,
      'pending_balance',   v_balance,
      'pending_capital',   v_capital,
      'unearned_interest', v_balance - v_capital,
      'late_fee_due',      v_late,
      'plan_principal',    v_principal,
      'plan_debt',         v_debt,
      'first_installment', null,
      'today',             v_today,
      'terms', jsonb_build_object(
        'interestRate', v_loan.interest_rate,
        'installments', v_loan.installments_count,
        'frequency',    v_loan.payment_frequency,
        'interestMode', 'monthly_prorated'),
      'new_late_fee', v_new_fee
    );
  end if;

  raise exception 'Tipo no soportado.';
end;
$function$;

revoke all on function public.refinance_quote_data(text, uuid) from public;
revoke execute on function public.refinance_quote_data(text, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. refinance_financing: la de 20261016090000 con el tope de 90 días en la
--    primera cuota (el mismo mensaje que trg_before_loan_checks en préstamos).
-- ---------------------------------------------------------------------------
create or replace function public.refinance_financing(
  p_sale_id uuid, p_base_mode text, p_late_fee_action text,
  p_interest_rate numeric, p_installments integer, p_frequency text, p_interest_mode text,
  p_first_due date, p_reason text,
  p_expected_balance numeric default null, p_expected_late_fee numeric default null)
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

  if p_first_due is not null and (p_first_due <= v_today or p_first_due > v_today + 90) then
    raise exception 'La primera cuota tiene que caer después de hoy y a no más de 90 días.';
  end if;
  if (v_q->>'pending_balance')::numeric <= 0 then
    raise exception 'Este financiamiento no tiene saldo pendiente.';
  end if;
  if (p_expected_balance is not null
      and abs((v_q->>'pending_balance')::numeric - p_expected_balance) > 0.005)
     or (p_expected_late_fee is not null
      and abs((v_q->>'late_fee_due')::numeric - p_expected_late_fee) > 0.005) then
    raise exception 'La deuda cambió desde que abriste la refinanciación: vuelve a abrirla para ver los montos de ahora.';
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
  if v_principal <= 0 then
    raise exception 'El capital del plan nuevo tiene que ser mayor que cero.';
  end if;

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

revoke all on function public.refinance_financing(uuid, text, text, numeric, integer, text, text, date, text, numeric, numeric) from public;
revoke execute on function public.refinance_financing(uuid, text, text, numeric, integer, text, text, date, text, numeric, numeric) from anon;
grant execute on function public.refinance_financing(uuid, text, text, numeric, integer, text, text, date, text, numeric, numeric) to authenticated;
