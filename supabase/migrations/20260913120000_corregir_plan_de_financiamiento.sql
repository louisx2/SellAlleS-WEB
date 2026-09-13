-- Corregir el plan de un financiamiento ya vendido, sin entrar a la base.
--
-- El hueco: una venta financiada con la tasa equivocada (el cajero tecleó 8
-- donde iba 7) no tenía arreglo desde la app. `financing_details` es jsonb en
-- `sales` y las cuotas viven en `financing_installments`, que desde
-- `financiamientos_integridad_y_cobros` ya no es escribible desde el navegador
-- — con razón. La única salida era un UPDATE a mano contra producción: sin
-- validación, sin rastro de quién lo hizo, y con el riesgo de dejar las cuotas
-- diciendo una cosa y el balance del cliente otra. Es el mismo razonamiento que
-- trajo `void_credit_payment`: si cerramos la puerta de atrás, la operación
-- legítima tiene que existir por delante.
--
-- Qué trae:
--
-- 1. El cálculo del plan deja de estar escrito dos veces. `financing_months` y
--    `financing_plan` son ahora la única fuente de verdad de la aritmética, y
--    `financing_due_date` la del calendario; los triggers de la venta pasan a
--    llamarlas. Sin esto, corregir un plan sería una tercera copia de la misma
--    fórmula esperando a desincronizarse de las otras dos.
--
-- 2. `amend_sale_financing`: recalcula el plan con los parámetros corregidos y
--    regenera las cuotas. Solo administradores, solo mientras NADIE haya pagado
--    una cuota. Un plan con abonos aplicados no se repreciona: primero se
--    anulan los abonos (`void_credit_payment`), que para eso está.
--
-- 3. `financing_amendments`: el antes y el después de cada corrección, con
--    quién y por qué. Repreciar una deuda sin dejar rastro es justo lo que hace
--    imposible explicarle al cliente por qué su cuota cambió.


-- ---------------------------------------------------------------------------
-- 1. La aritmética del plan, en un solo lugar
-- ---------------------------------------------------------------------------

-- Meses de interés que cobra un plan. Con frecuencia mensual los dos modos dan
-- v_n, que es el cálculo de siempre. Espejo de `monthsFor` en src/lib/frequency.ts.
create or replace function public.financing_months(p_freq text, p_n int, p_mode text)
returns numeric
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_mode = 'per_installment' then p_n::numeric
    when p_freq = 'weekly'          then p_n / 4.0
    when p_freq = 'biweekly'        then p_n / 2.0
    else p_n::numeric
  end;
$function$;

comment on function public.financing_months(text, int, text) is
  'Meses de interés de un plan de cuotas: en monthly_prorated la tasa mensual se prorratea a la duración real del plan; en per_installment cada cuota cobra la tasa.';

-- Interés simple add-on y monto de cuota. Devuelve jsonb para que quien llama
-- no tenga que repetir los redondeos, que son parte del contrato: `numeric` de
-- la columna redondea igual y una cuota mal redondeada descuadra la suma.
create or replace function public.financing_plan(
  p_principal numeric, p_rate numeric, p_n int, p_freq text, p_mode text
) returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
  with base as (
    select round(p_principal, 2) as principal,
           public.financing_months(p_freq, p_n, p_mode) as months
  ), calc as (
    select principal, months,
           round(principal * p_rate / 100 * months, 2) as interest
      from base
  )
  select jsonb_build_object(
    'principal',   principal,
    'months',      months,
    'interest',    interest,
    'debt',        principal + interest,
    'installment', round((principal + interest) / p_n, 2)
  ) from calc;
$function$;

-- Vencimiento de la cuota k (1-based). Semanal y quincenal cuentan días
-- corridos desde la venta; mensual cae el mismo día del mes.
create or replace function public.financing_due_date(p_start date, p_freq text, p_k int)
returns date
language sql
immutable
set search_path to 'public'
as $function$
  select case p_freq
    when 'weekly'   then p_start + (p_k * 7)
    when 'biweekly' then p_start + (p_k * 14)
    else (p_start + make_interval(months => p_k))::date
  end;
$function$;

-- Valida los parámetros de un plan con los mensajes que ve el usuario. La
-- comparten el trigger de la venta y la corrección: si mañana se sube el tope
-- de cuotas, sube en los dos a la vez.
create or replace function public.validate_financing_params(
  p_rate numeric, p_n int, p_freq text, p_mode text
) returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if p_n is null or p_n < 1 or p_n > 60 then
    raise exception 'La cantidad de cuotas debe estar entre 1 y 60.';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'La tasa de interés no es válida.';
  end if;
  if p_freq not in ('weekly','biweekly','monthly') then
    raise exception 'Frecuencia de pago no válida.';
  end if;
  if p_mode not in ('monthly_prorated','per_installment') then
    raise exception 'Modo de interés no válido.';
  end if;
end;
$function$;

-- Ojo con el `revoke ... from public`: las default privileges de Supabase le
-- dan EXECUTE a `anon` a toda función NUEVA con un grant directo, que un
-- revoke a PUBLIC no toca (ver `cobros_sin_execute_para_anon`). Hay que
-- nombrar a `anon` explícitamente o la función queda llamable sin sesión.
revoke all on function public.financing_months(text, int, text) from public, anon;
revoke all on function public.financing_plan(numeric, numeric, int, text, text) from public, anon;
revoke all on function public.financing_due_date(date, text, int) from public, anon;
revoke all on function public.validate_financing_params(numeric, int, text, text) from public, anon;
grant execute on function public.financing_months(text, int, text) to authenticated, service_role;
grant execute on function public.financing_plan(numeric, numeric, int, text, text) to authenticated, service_role;
grant execute on function public.financing_due_date(date, text, int) to authenticated, service_role;
grant execute on function public.validate_financing_params(numeric, int, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. Los triggers de la venta pasan a usar esas funciones
-- ---------------------------------------------------------------------------
--
-- Cuerpo idéntico al que estaba en producción: lo único que cambia es de dónde
-- sale la fórmula. Para todo plan existente el resultado es el mismo número.

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

    perform validate_financing_params(v_rate, v_n, v_freq, v_mode);

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
      'lateFeeGraceDays',  v_grace
    );
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

-- Genera las cuotas de un plan. La última absorbe el redondeo para que la suma
-- dé exactamente la deuda; sin eso el cliente termina debiendo dos centavos
-- que nadie sabe de dónde salieron.
create or replace function public.build_financing_schedule(
  p_company_id uuid, p_sale_id uuid, p_start date, p_freq text,
  p_n int, p_installment numeric, p_debt numeric
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k        int;
  v_amount numeric;
begin
  for k in 1..p_n loop
    v_amount := case when k < p_n then p_installment
                     else p_debt - p_installment * (p_n - 1) end;

    insert into financing_installments (company_id, sale_id, installment_number, due_date, amount)
    values (p_company_id, p_sale_id, k, financing_due_date(p_start, p_freq, k), v_amount);
  end loop;
end;
$function$;

-- Solo la llaman funciones SECURITY DEFINER (los triggers de la venta y la
-- corrección), que corren como dueño: el navegador no tiene por qué poder
-- inventarse un cronograma.
revoke all on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric) from public;
revoke all on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric) from anon, authenticated;
grant execute on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric) to service_role;

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

    -- Una venta de las 9:00 PM en RD ya es "mañana" en UTC: el plan arrancaba
    -- un día después del que decía el recibo.
    v_start := (new.created_at at time zone coalesce(
                  (select nullif(btrim(timezone), '') from companies where id = new.company_id),
                  'America/Santo_Domingo'))::date;

    perform build_financing_schedule(new.company_id, new.id, v_start, v_freq, v_n, v_cuota, v_debt);
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
-- 3. Bitácora de correcciones
-- ---------------------------------------------------------------------------

create table if not exists public.financing_amendments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  sale_id         uuid not null references public.sales(id) on delete cascade,
  reason          text not null,
  details_before  jsonb not null,
  details_after   jsonb not null,
  changed_by      uuid references public.profiles(id),
  changed_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists financing_amendments_sale_idx
  on public.financing_amendments (sale_id, created_at desc);
create index if not exists financing_amendments_company_idx
  on public.financing_amendments (company_id, created_at desc);

comment on table public.financing_amendments is
  'Bitácora de correcciones al plan de un financiamiento: el antes y el después de financing_details, con quién lo cambió y por qué. Solo la escribe amend_sale_financing.';

alter table public.financing_amendments enable row level security;

-- Solo lectura, y solo para quien puede corregir: es información sensible
-- (dice que a este cliente se le cambió la deuda) y no tiene por qué verla
-- todo el mundo. La escribe únicamente la RPC, que es SECURITY DEFINER.
drop policy if exists financing_amendments_select on public.financing_amendments;
create policy financing_amendments_select on public.financing_amendments
  for select using (
    (company_id = current_company_id() and is_company_admin()) or is_super_admin()
  );

revoke all on table public.financing_amendments from anon, authenticated;
grant select on table public.financing_amendments to authenticated;


-- ---------------------------------------------------------------------------
-- 4. La RPC
-- ---------------------------------------------------------------------------

create or replace function public.amend_sale_financing(
  p_sale_id       uuid,
  p_interest_rate numeric,
  p_installments  int,
  p_frequency     text,
  p_interest_mode text,
  p_reason        text
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

  -- Las cuotas se regeneran completas porque la cantidad puede cambiar. Es
  -- seguro justo por el chequeo de arriba: ninguna trae dinero aplicado.
  -- El calendario arranca el día de la VENTA, no el de hoy: corregir la tasa
  -- no debe correrle los vencimientos al cliente.
  delete from financing_installments where sale_id = p_sale_id;

  v_start := (v_sale.created_at at time zone coalesce(
                (select nullif(btrim(timezone), '') from companies where id = v_sale.company_id),
                'America/Santo_Domingo'))::date;

  perform build_financing_schedule(
    v_sale.company_id, v_sale.id, v_start, v_freq, v_n,
    (v_plan->>'installment')::numeric, (v_plan->>'debt')::numeric
  );

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

comment on function public.amend_sale_financing(uuid, numeric, int, text, text, text) is
  'Corrige el plan de un financiamiento ya vendido (tasa, cuotas, frecuencia, modo de interés): recalcula con la misma fórmula de la venta, regenera las cuotas desde la fecha original y deja el antes/después en financing_amendments. Solo administradores y solo si ninguna cuota tiene dinero aplicado.';

-- `anon` explícito por lo mismo de arriba: se defiende sola (sin sesión
-- `is_company_admin()` es false), pero repreciar una deuda no tiene por qué
-- estar al alcance de una llamada sin autenticar.
revoke all on function public.amend_sale_financing(uuid, numeric, int, text, text, text) from public, anon;
grant execute on function public.amend_sale_financing(uuid, numeric, int, text, text, text) to authenticated, service_role;

-- Las funciones de trigger las invoca Postgres, no la app: con EXECUTE para
-- `authenticated` quedarían expuestas por PostgREST. `create or replace`
-- conserva los permisos que ya tenían, pero esto lo deja explícito.
revoke all on function public.before_sale_credit_checks() from public, anon, authenticated;
revoke all on function public.after_sale_credit_effects() from public, anon, authenticated;
