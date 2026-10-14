-- Fechas de pago de los financiamientos (4 de 4): corregir el plan ya no pisa
-- las fechas. Con la misma cantidad de cuotas y la misma frecuencia, cada
-- cuota se queda en su fecha; si cambian, el plan arranca en el primer pago de
-- antes cuando no era el de siempre.

create or replace function public.amend_sale_financing(
  p_sale_id uuid,
  p_interest_rate numeric,
  p_installments int,
  p_frequency text,
  p_interest_mode text,
  p_reason text
) returns jsonb
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
