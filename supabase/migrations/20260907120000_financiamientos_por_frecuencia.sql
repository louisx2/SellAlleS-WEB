-- Financiamientos por frecuencia: semanal, quincenal y mensual, con los
-- parámetros configurables por sucursal.
--
-- El módulo solo sabía hacer cuotas mensuales, y lo estaba en los dos extremos:
-- el POS armaba el cronograma con `addMonths` y `after_sale_credit_effects`
-- quemaba el mes en `make_interval(months => k)`. El módulo de Préstamos ya
-- había resuelto exactamente esto (`trg_before_loan_checks` prorratea la tasa
-- mensual a la duración real del plan, `trg_after_loan_effects` calcula el
-- vencimiento según la frecuencia), así que aquí se porta ese patrón probado a
-- las ventas financiadas en vez de inventar otro.
--
-- Lo demás que trae:
--
-- 1. La tasa se puede cobrar de dos maneras y ahora se elige. 'monthly_prorated'
--    (la tasa es MENSUAL: 12 cuotas quincenales son 6 meses de interés, como
--    Préstamos) o 'per_installment' (cada cuota cobra la tasa). En frecuencia
--    mensual las dos dan el mismo número, que es justo lo que se cobraba hasta
--    hoy: para todo lo que ya existe el cambio es matemáticamente neutro.
--
-- 2. Los parámetros del POS y la mora bajan a nivel de sucursal, con columnas
--    NULL = hereda de la empresa. Es el patrón de `branches.max_users` y del
--    perfil del ticket, no uno nuevo. Cada sucursal financia como entienda.
--
-- 3. La mora se CONGELA en el plan al crearlo. Sin eso, bajarla a sucursal
--    repreciaría hacia atrás todas las deudas abiertas cada vez que alguien
--    mueve el ajuste. Como consecuencia `register_customer_payment` deja de
--    resolver UNA tasa para todas las ventas del cliente y pasa a usar la de
--    cada venta: un cliente con financiamientos de dos sucursales con moras
--    distintas se cobraba mal.
--
-- 4. `branches.financing_enabled`: una sucursal puede no financiar. Mismo "dos
--    interruptores" que la caja — el módulo dice si la EMPRESA lo ve, la
--    sucursal si lo USA. Default true, porque hoy financian todas.

-- ---------------------------------------------------------------------------
-- 1. Ajustes de la empresa (los valores por defecto de toda la cuenta)
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists financing_interest_mode        text not null default 'monthly_prorated',
  add column if not exists financing_default_frequency    text not null default 'monthly',
  add column if not exists financing_default_installments int  not null default 12;

alter table public.companies drop constraint if exists companies_financing_interest_mode_check;
alter table public.companies add constraint companies_financing_interest_mode_check
  check (financing_interest_mode in ('monthly_prorated','per_installment'));

alter table public.companies drop constraint if exists companies_financing_default_frequency_check;
alter table public.companies add constraint companies_financing_default_frequency_check
  check (financing_default_frequency in ('weekly','biweekly','monthly'));

alter table public.companies drop constraint if exists companies_financing_default_installments_check;
alter table public.companies add constraint companies_financing_default_installments_check
  check (financing_default_installments between 1 and 60);

comment on column public.companies.financing_interest_mode is
  'Cómo se aplica la tasa: monthly_prorated (mensual, se prorratea a la duración real del plan) o per_installment (la tasa se cobra en cada cuota).';

-- ---------------------------------------------------------------------------
-- 2. Ajustes de la sucursal — NULL = hereda de la empresa
-- ---------------------------------------------------------------------------

alter table public.branches
  add column if not exists default_interest_rate          numeric,
  add column if not exists late_fee_rate                  numeric,
  add column if not exists financing_interest_mode        text,
  add column if not exists financing_default_frequency    text,
  add column if not exists financing_default_installments int,
  add column if not exists financing_enabled              boolean not null default true;

alter table public.branches drop constraint if exists branches_financing_interest_mode_check;
alter table public.branches add constraint branches_financing_interest_mode_check
  check (financing_interest_mode is null or financing_interest_mode in ('monthly_prorated','per_installment'));

alter table public.branches drop constraint if exists branches_financing_default_frequency_check;
alter table public.branches add constraint branches_financing_default_frequency_check
  check (financing_default_frequency is null or financing_default_frequency in ('weekly','biweekly','monthly'));

alter table public.branches drop constraint if exists branches_financing_default_installments_check;
alter table public.branches add constraint branches_financing_default_installments_check
  check (financing_default_installments is null or financing_default_installments between 1 and 60);

alter table public.branches drop constraint if exists branches_default_interest_rate_check;
alter table public.branches add constraint branches_default_interest_rate_check
  check (default_interest_rate is null or default_interest_rate between 0 and 100);

alter table public.branches drop constraint if exists branches_late_fee_rate_check;
alter table public.branches add constraint branches_late_fee_rate_check
  check (late_fee_rate is null or late_fee_rate between 0 and 100);

comment on column public.branches.financing_enabled is
  'Si esta sucursal ofrece financiamiento. Requiere además que el módulo financing esté encendido en la empresa. Default true: hasta ahora financiaban todas.';

-- ---------------------------------------------------------------------------
-- 3. Antes de guardar la venta: validar, prorratear y congelar
-- ---------------------------------------------------------------------------
-- Punto único de verdad del dinero: el POS solo manda una vista previa, lo que
-- queda grabado en `financing_details` lo arma esta función.

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
  v_principal  numeric;
  v_interest   numeric;
  v_cuota      numeric;
  v_debt       numeric;
  v_freq       text;
  v_mode       text;
  v_months     numeric;
  v_late_rate  numeric;
  v_grace      int;
  v_mode_deflt text;
  v_fin_on     boolean;
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
           coalesce(c.late_fee_grace_days, 0),
           coalesce(b.financing_interest_mode, c.financing_interest_mode, 'monthly_prorated'),
           coalesce(b.financing_enabled, true)
      into v_late_rate, v_grace, v_mode_deflt, v_fin_on
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

    if v_n < 1 or v_n > 60 then
      raise exception 'La cantidad de cuotas debe estar entre 1 y 60.';
    end if;
    if v_rate < 0 or v_rate > 100 then
      raise exception 'La tasa de interés no es válida.';
    end if;
    if v_freq not in ('weekly','biweekly','monthly') then
      raise exception 'Frecuencia de pago no válida.';
    end if;
    if v_mode not in ('monthly_prorated','per_installment') then
      raise exception 'Modo de interés no válido.';
    end if;

    -- Interés SIMPLE. En 'monthly_prorated' la tasa es MENSUAL y se prorratea a
    -- los meses que dura el plan de verdad (igual que trg_before_loan_checks);
    -- en 'per_installment' cada cuota cobra la tasa. Con frecuencia mensual los
    -- dos caminos dan v_months = v_n, que es el cálculo de siempre.
    v_months := case
      when v_mode = 'per_installment' then v_n::numeric
      when v_freq = 'weekly'          then v_n / 4.0
      when v_freq = 'biweekly'        then v_n / 2.0
      else v_n::numeric
    end;

    v_principal := round(new.total - new.amount_paid, 2);
    v_interest  := round(v_principal * v_rate / 100 * v_months, 2);
    v_cuota     := round((v_principal + v_interest) / v_n, 2);

    new.financing_details := jsonb_build_object(
      'interestRate',      v_rate,
      'interestMode',      v_mode,
      'frequency',         v_freq,
      'installments',      v_n,
      'installmentAmount', v_cuota,
      'totalWithInterest', v_principal + v_interest + new.amount_paid,
      'downPayment',       new.amount_paid,
      -- Congeladas: mover el ajuste de la sucursal no debe repreciar esta deuda.
      'lateFeeRate',       v_late_rate,
      'lateFeeGraceDays',  v_grace
    );
    v_debt := v_principal + v_interest;
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

-- ---------------------------------------------------------------------------
-- 4. Después de guardar la venta: el cronograma, con la fecha de cada cuota
-- ---------------------------------------------------------------------------

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
  v_amount    numeric;
  k           int;
  v_user_name text;
  v_start     date;
  v_freq      text;
  v_due       date;
begin
  if new.payment_status not in ('credit','in_financing') then
    return new;
  end if;

  if new.payment_status = 'in_financing' then
    v_n     := (new.financing_details->>'installments')::int;
    v_cuota := (new.financing_details->>'installmentAmount')::numeric;
    v_debt  := (new.financing_details->>'totalWithInterest')::numeric - new.amount_paid;
    v_freq  := coalesce(nullif(new.financing_details->>'frequency', ''), 'monthly');

    -- Una venta de las 9:00 PM en RD ya es "mañana" en UTC: el plan arrancaba
    -- un día después del que decía el recibo.
    v_start := (new.created_at at time zone coalesce(
                  (select nullif(btrim(timezone), '') from companies where id = new.company_id),
                  'America/Santo_Domingo'))::date;

    for k in 1..v_n loop
      if k < v_n then
        v_amount := v_cuota;
      else
        v_amount := v_debt - v_cuota * (v_n - 1);
      end if;

      -- Semanal y quincenal cuentan días corridos desde la venta (igual que
      -- trg_after_loan_effects); mensual sigue cayendo el mismo día del mes.
      v_due := case v_freq
        when 'weekly'   then v_start + (k * 7)
        when 'biweekly' then v_start + (k * 14)
        else (v_start + make_interval(months => k))::date
      end;

      insert into financing_installments (company_id, sale_id, installment_number, due_date, amount)
      values (new.company_id, new.id, k, v_due, v_amount);
    end loop;
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

-- ---------------------------------------------------------------------------
-- 5. Cobrar una venta: la mora sale del plan, no de la empresa
-- ---------------------------------------------------------------------------
-- Único cambio respecto de la versión anterior: de dónde salen v_late_rate y
-- v_grace. `apply_payment_to_sale` no se toca — ya los recibe por parámetro.

create or replace function public.register_sale_payment(
  p_sale_id uuid, p_amount numeric, p_method text,
  p_branch_id uuid default null, p_notes text default null, p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale        sales%rowtype;
  v_late_rate   numeric;
  v_grace       int;
  v_co_rate     numeric;
  v_co_grace    int;
  v_today       date;
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

  select coalesce(late_fee_rate, 5), coalesce(late_fee_grace_days, 0)
    into v_co_rate, v_co_grace
    from companies where id = v_sale.company_id;

  -- La mora del plan manda: se congeló al crearlo para que mover el ajuste de
  -- la sucursal no repricie una deuda vieja. Las ventas anteriores al cambio
  -- no la traen y caen a la de la empresa, que es como se cobraban.
  v_late_rate := coalesce((v_sale.financing_details->>'lateFeeRate')::numeric, v_co_rate, 5);
  v_grace     := coalesce((v_sale.financing_details->>'lateFeeGraceDays')::int, v_co_grace, 0);
  v_today     := company_today(v_sale.company_id);

  if v_sale.payment_status = 'in_financing' then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;
    select coalesce(sum(greatest(round(amount * v_late_rate / 100, 2) - late_fee_paid, 0)), 0)
      into v_late_due
      from financing_installments
     where sale_id = p_sale_id and status <> 'paid' and due_date + v_grace < v_today;
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
  end if;

  if p_amount > v_total_due + v_late_due + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'),
      to_char(v_total_due + v_late_due, 'FM999,999,990.00');
  end if;

  v_res := apply_payment_to_sale(p_sale_id, p_amount, v_late_rate, v_today, v_grace);

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

  select count(*) filter (where status = 'paid'), count(*)
    into v_paid_count, v_total_count
    from financing_installments
   where sale_id = p_sale_id;

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
-- 6. Abono general del cliente: una mora POR VENTA, no una para todas
-- ---------------------------------------------------------------------------
-- Esta es la parte delicada del cambio. Antes se resolvía una sola v_late_rate
-- arriba y se usaba para todas las ventas del cliente; con la mora congelada
-- por plan eso cobra mal a un cliente que tiene financiamientos de dos
-- sucursales con moras distintas. Hay dos lugares que dependían de ello: el
-- techo `v_max` y la llamada a `apply_payment_to_sale` dentro del bucle.

create or replace function public.register_customer_payment(
  p_customer_id uuid, p_amount numeric, p_method text,
  p_branch_id uuid default null, p_notes text default null, p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer   customers%rowtype;
  v_late_rate  numeric;
  v_grace      int;
  v_today      date;
  v_max        numeric := 0;
  v_remaining  numeric;
  v_sale       record;
  v_res        jsonb;
  v_allocs     jsonb := '[]'::jsonb;
  v_late_total numeric := 0;
  v_principal  numeric := 0;
  v_payment_id uuid;
  v_user_name  text;
  v_balance    numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_customer from customers where id = p_customer_id for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;
  if not (is_super_admin() or (v_customer.company_id = current_company_id()
          and (is_company_admin()
               or v_customer.branch_id is null
               or v_customer.branch_id in (select user_branch_ids())
               or branch_shares_with_me('clientes', v_customer.branch_id)
               or branch_shares_with_me('credito', v_customer.branch_id)))) then
    raise exception 'No tienes acceso a este cliente.';
  end if;

  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_customer.company_id;
    if not found then
      raise exception 'Sucursal no válida para este cliente.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_customer.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  -- Estas dos son solo el FALLBACK para las ventas anteriores al congelado de
  -- la mora; la tasa que se aplica sale del plan de cada venta.
  select coalesce(late_fee_rate, 5), coalesce(late_fee_grace_days, 0)
    into v_late_rate, v_grace
    from companies where id = v_customer.company_id;
  v_late_rate := coalesce(v_late_rate, 5);
  v_grace     := coalesce(v_grace, 0);
  v_today     := company_today(v_customer.company_id);

  -- El techo sale de las ventas, no de `credit_balance`: capital pendiente más
  -- la mora exigible de las cuotas ya vencidas, cada una con SU tasa.
  select coalesce(sum(deuda + mora), 0) into v_max
    from (
      select
        case when s.payment_status = 'in_financing'
             then coalesce((s.financing_details->>'totalWithInterest')::numeric, s.total) - s.amount_paid
             else s.total - s.amount_paid end as deuda,
        coalesce((select sum(greatest(
                            round(fi.amount * coalesce((s.financing_details->>'lateFeeRate')::numeric,
                                                       v_late_rate) / 100, 2)
                            - fi.late_fee_paid, 0))
                    from financing_installments fi
                   where fi.sale_id = s.id and fi.status <> 'paid'
                     and fi.due_date + coalesce((s.financing_details->>'lateFeeGraceDays')::int,
                                                v_grace) < v_today), 0) as mora
        from sales s
       where s.customer_id = p_customer_id
         and s.payment_status in ('credit','in_financing')
         and s.cancelled_at is null
         and can_collect_sale(s.id)
    ) t;

  if v_max <= 0.01 then
    raise exception 'Este cliente no tiene deuda pendiente que puedas cobrar desde esta sucursal.';
  end if;
  if p_amount > v_max + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda del cliente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'), to_char(v_max, 'FM999,999,990.00');
  end if;

  -- Primero la venta con el vencimiento más viejo; si no tiene plan de cuotas,
  -- vale la fecha de la venta. Es el orden que espera cualquiera que cobre.
  v_remaining := p_amount;
  for v_sale in
    select s.id,
           coalesce((s.financing_details->>'lateFeeRate')::numeric, v_late_rate)   as late_rate,
           coalesce((s.financing_details->>'lateFeeGraceDays')::int, v_grace)      as grace,
           coalesce((select min(fi.due_date) from financing_installments fi
                      where fi.sale_id = s.id and fi.status <> 'paid'),
                    (s.created_at at time zone coalesce(nullif(btrim(c.timezone), ''), 'America/Santo_Domingo'))::date) as orden
      from sales s
      join companies c on c.id = s.company_id
     where s.customer_id = p_customer_id
       and s.payment_status in ('credit','in_financing')
       and s.cancelled_at is null
       and can_collect_sale(s.id)
     order by orden, s.created_at
  loop
    exit when v_remaining <= 0.005;
    v_res := apply_payment_to_sale(v_sale.id, v_remaining, v_sale.late_rate, v_today, v_sale.grace);
    if (v_res->>'consumed')::numeric > 0 then
      v_allocs     := v_allocs || v_res;
      v_late_total := v_late_total + (v_res->>'late_fee')::numeric;
      v_principal  := v_principal + (v_res->>'principal')::numeric;
      v_remaining  := v_remaining - (v_res->>'consumed')::numeric;
    end if;
  end loop;

  if v_remaining > 0.01 then
    raise exception 'No se pudo aplicar RD$% del abono a ninguna venta abierta. Revisa el balance del cliente.',
      to_char(v_remaining, 'FM999,999,990.00');
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_payments
    (company_id, sale_id, customer_id, branch_id, amount, late_fee_paid, method,
     reference, notes, user_id, user_name, date, kind, allocation)
  values
    (v_customer.company_id, null, p_customer_id, p_branch_id, p_amount,
     round(v_late_total, 2), p_method, p_reference, p_notes,
     auth.uid(), v_user_name, now(), 'customer',
     jsonb_build_object('sales', v_allocs))
  returning id into v_payment_id;

  v_balance := recompute_customer_balance(p_customer_id);

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             p_amount,
    'late_fee_paid',      round(v_late_total, 2),
    'principal_paid',     round(v_principal, 2),
    'remaining_balance',  v_balance,
    'installments_paid',  null,
    'installments_total', null,
    'customer_balance',   v_balance,
    'sales_touched',      jsonb_array_length(v_allocs)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Congelar la mora de los financiamientos que ya están abiertos
-- ---------------------------------------------------------------------------
-- Se les graba la tasa y la gracia ACTUALES de su empresa, que es exactamente
-- con las que se venían cobrando. Sin esto, "congelada" solo valdría para los
-- planes nuevos y bajarle la mora a una sucursal movería las deudas viejas.

update public.sales s
   set financing_details = s.financing_details
       || jsonb_build_object('lateFeeRate',      coalesce(c.late_fee_rate, 5),
                             'lateFeeGraceDays', coalesce(c.late_fee_grace_days, 0))
  from public.companies c
 where c.id = s.company_id
   and s.payment_status::text = 'in_financing'
   and s.cancelled_at is null
   and s.financing_details ? 'installments'
   and not (s.financing_details ? 'lateFeeRate');

-- `create or replace function` conserva los grants, y no se crea ninguna
-- función nueva: no hay que volver a revocar `execute` a anon.
