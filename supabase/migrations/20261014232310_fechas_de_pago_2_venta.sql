-- Fechas de pago de los financiamientos (2 de 4): la venta valida el primer
-- pago elegido en el POS y arma el calendario desde él.

create or replace function public.before_sale_credit_checks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer   customers%rowtype;
  v_rate       numeric;
  v_n          int;
  v_plan       jsonb;
  v_debt       numeric;
  v_freq       text;
  v_mode       text;
  v_late_rate  numeric;
  v_late_mode  text;
  v_grace      int;
  v_max_rate   numeric;
  v_mode_deflt text;
  v_fin_on     boolean;
  v_start      date;
  v_first      date;
begin
  if new.payment_status not in ('credit','in_financing') then
    return new;
  end if;

  if new.customer_id is null then
    raise exception 'Debe seleccionar un cliente para vender a crédito o financiar.';
  end if;

  select * into v_customer
    from customers
   where id = new.customer_id and company_id = new.company_id
   for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if new.amount_paid < 0 then
    raise exception 'El abono inicial no puede ser negativo.';
  end if;

  if new.payment_status = 'in_financing' then
    if new.financing_details is null then
      raise exception 'Falta el plan de financiamiento.';
    end if;
    if new.amount_paid >= new.total then
      raise exception 'El abono inicial debe ser menor que el total para financiar.';
    end if;

    -- Ajustes efectivos: lo que tenga la sucursal manda, lo que no, se hereda
    -- de la empresa. Mismo criterio que el perfil del ticket.
    select coalesce(b.late_fee_rate, c.late_fee_rate, 5),
           coalesce(b.late_fee_mode, c.late_fee_mode, 'once'),
           coalesce(b.late_fee_grace_days, c.late_fee_grace_days, 0),
           coalesce(b.late_fee_max_rate, c.late_fee_max_rate, 0),
           coalesce(b.financing_interest_mode, c.financing_interest_mode, 'monthly_prorated'),
           coalesce(b.financing_enabled, true)
      into v_late_rate, v_late_mode, v_grace, v_max_rate, v_mode_deflt, v_fin_on
      from companies c
      left join branches b on b.id = new.branch_id and b.company_id = c.id
     where c.id = new.company_id;

    -- El interruptor de la sucursal se defiende aquí, no solo escondiendo el
    -- botón del POS.
    if new.branch_id is not null and not coalesce(v_fin_on, true) then
      raise exception 'Esta sucursal no tiene habilitado el financiamiento.';
    end if;

    v_rate := coalesce((new.financing_details->>'interestRate')::numeric, 0);
    v_n    := coalesce((new.financing_details->>'installments')::int, 0);
    -- Los planes viejos no traen estos dos campos: mensual prorrateado es
    -- exactamente lo que se venía cobrando.
    v_freq := coalesce(nullif(new.financing_details->>'frequency', ''), 'monthly');
    v_mode := coalesce(nullif(new.financing_details->>'interestMode', ''), v_mode_deflt);

    perform validate_financing_params(v_rate, v_n, v_freq, v_mode);
    perform validate_late_fee_params(v_late_rate, v_late_mode, v_grace, v_max_rate);

    -- Primer pago elegido en el POS: desde el día de la venta hasta 90 días
    -- después. Si coincide con el de siempre no se guarda, para que el plan
    -- siga contándose desde la venta (en mensual no da lo mismo: una venta
    -- del 31 cae el 28 de febrero y vuelve al 31 en marzo).
    if nullif(btrim(coalesce(new.financing_details->>'firstDueDate', '')), '') is not null then
      begin
        v_first := (new.financing_details->>'firstDueDate')::date;
      exception when data_exception then
        raise exception 'La fecha del primer pago no es válida.';
      end;

      v_start := sale_local_date(new.company_id, new.created_at);
      if v_first < v_start then
        raise exception 'La fecha del primer pago no puede ser anterior a la venta.';
      end if;
      if v_first > v_start + 90 then
        raise exception 'La fecha del primer pago no puede pasar de 90 días después de la venta.';
      end if;
      if v_first = financing_due_date(v_start, v_freq, 1) then
        v_first := null;
      end if;
    end if;

    -- Interés SIMPLE, prorrateado o por cuota según el modo (ver
    -- `financing_plan`). Los montos los calcula SIEMPRE el servidor: lo que
    -- manda el navegador es una propuesta.
    v_plan := financing_plan(new.total - new.amount_paid, v_rate, v_n, v_freq, v_mode);

    new.financing_details := jsonb_build_object(
      'interestRate',      v_rate,
      'interestMode',      v_mode,
      'frequency',         v_freq,
      'installments',      v_n,
      'installmentAmount', (v_plan->>'installment')::numeric,
      'totalWithInterest', (v_plan->>'debt')::numeric + new.amount_paid,
      'downPayment',       new.amount_paid,
      -- Congeladas: mover el ajuste de la sucursal no debe repreciar esta deuda.
      'lateFeeRate',       v_late_rate,
      'lateFeeMode',       v_late_mode,
      'lateFeeGraceDays',  v_grace,
      'lateFeeMaxRate',    v_max_rate
    ) || case when v_first is not null
              then jsonb_build_object('firstDueDate', v_first)
              else '{}'::jsonb end;
    v_debt := (v_plan->>'debt')::numeric;
  else
    -- Crédito simple pagado completo en caja: se normaliza a 'paid'.
    if new.amount_paid >= new.total then
      new.payment_status := 'paid';
      return new;
    end if;
    v_debt := round(new.total - new.amount_paid, 2);
  end if;

  if v_customer.credit_limit is not null
     and v_customer.credit_balance + v_debt > v_customer.credit_limit then
    raise exception 'Límite de crédito excedido: disponible RD$%, deuda nueva RD$%.',
      to_char(greatest(v_customer.credit_limit - v_customer.credit_balance, 0), 'FM999,999,990.00'),
      to_char(v_debt, 'FM999,999,990.00');
  end if;

  return new;
end;
$function$;

create or replace function public.after_sale_credit_effects()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n         int;
  v_cuota     numeric;
  v_debt      numeric;
  v_user_name text;
  v_start     date;
  v_freq      text;
begin
  if new.payment_status not in ('credit','in_financing') then
    return new;
  end if;

  if new.payment_status = 'in_financing' then
    v_n     := (new.financing_details->>'installments')::int;
    v_cuota := (new.financing_details->>'installmentAmount')::numeric;
    v_debt  := (new.financing_details->>'totalWithInterest')::numeric - new.amount_paid;
    v_freq  := coalesce(nullif(new.financing_details->>'frequency', ''), 'monthly');
    v_start := sale_local_date(new.company_id, new.created_at);

    -- `firstDueDate` ya viene validado por before_sale_credit_checks.
    perform build_financing_schedule(new.company_id, new.id, v_start, v_freq, v_n, v_cuota, v_debt,
                                     (new.financing_details->>'firstDueDate')::date);
  else
    v_debt := round(new.total - new.amount_paid, 2);
  end if;

  update customers
     set credit_balance = credit_balance + v_debt
   where id = new.customer_id;

  -- Abono inicial: se registra como pago con su método/referencia.
  if coalesce(new.amount_paid, 0) > 0 then
    select name into v_user_name from profiles where id = auth.uid();
    insert into credit_payments
      (company_id, sale_id, customer_id, branch_id, amount, method, reference, notes, user_id, user_name, date, kind)
    values
      (new.company_id, new.id, new.customer_id, new.branch_id, new.amount_paid,
       coalesce(new.down_payment_method, 'cash'), new.down_payment_reference,
       'Abono inicial', auth.uid(), v_user_name, new.created_at, 'down_payment');
  end if;

  return new;
end;
$function$;

-- Las funciones de trigger las invoca Postgres, no la app: con EXECUTE para
-- `authenticated` quedarían expuestas por PostgREST. `create or replace`
-- conserva los permisos que ya tenían, pero esto lo deja explícito.
revoke all on function public.before_sale_credit_checks() from public, anon, authenticated;
revoke all on function public.after_sale_credit_effects() from public, anon, authenticated;
