-- Fechas de pago de los financiamientos: elegir el primer pago al vender y
-- reprogramar después las cuotas pendientes.
--
-- El hueco: las fechas de las cuotas salían solas del día de la venta más la
-- frecuencia, y no había forma de moverlas. Al cliente que cobra el 30 se le
-- ponía la cuota el 10 porque compró un 10, y una prórroga solo se podía dar
-- con un UPDATE a mano contra producción: sin validación ni rastro, y con el
-- recordatorio ya marcado como enviado para la fecha vieja.
--
-- Qué trae:
--
-- 1. `financing_details.firstDueDate`: la fecha del primer pago que se eligió
--    en el POS. Las demás cuotas se cuentan desde ella con la misma
--    frecuencia. Sin ella (o si coincide con la de siempre) el calendario es
--    exactamente el de antes, contado desde la venta. El interés no cambia: lo
--    deciden la cantidad de cuotas y la frecuencia, no la fecha.
--
-- 2. `reschedule_financing_installments`: mueve la fecha de una cuota sin
--    pagar y, si se pide, recalcula las siguientes desde ahí. Solo
--    administradores. Las cuotas pagadas no se tocan y las fechas tienen que
--    quedar en orden. La mora se deriva de la fecha al leer, así que una
--    cuota vencida que pasa a una fecha futura deja de devengarla; la ya
--    cobrada (`late_fee_paid`) se queda donde está.
--
-- 3. `financing_schedule_changes`: quién movió qué fecha, cuándo y por qué.
--    Mover un vencimiento le quita mora al cliente, y eso tiene que poder
--    explicarse después.
--
-- 4. `amend_sale_financing` deja de pisar las fechas: con la misma cantidad de
--    cuotas y la misma frecuencia, cada cuota se queda en su fecha; si cambian,
--    el plan corregido arranca en el primer pago de antes cuando no era el de
--    siempre (se eligió al vender o se reprogramó).


-- ---------------------------------------------------------------------------
-- 1. El calendario
-- ---------------------------------------------------------------------------

-- El día de la venta en la hora del negocio. La base corre en UTC: una venta
-- de las 9:00 PM en RD ya es "mañana". Sin SECURITY DEFINER y sin EXECUTE
-- para el navegador: solo la llaman funciones que ya corren como dueño, y así
-- no sirve para leer la zona horaria de otra empresa saltándose RLS.
create or replace function public.sale_local_date(p_company_id uuid, p_ts timestamptz)
returns date
language sql
stable
set search_path to 'public'
as $function$
  select (p_ts at time zone coalesce(
            (select nullif(btrim(timezone), '') from companies where id = p_company_id),
            'America/Santo_Domingo'))::date;
$function$;

-- Vencimiento de la cuota `k` (1-based). Sin primer pago elegido: k períodos
-- desde la venta, lo de siempre. Con primer pago: esa fecha y k-1 períodos
-- más. Contar siempre desde el ancla (y no de cuota en cuota) es lo que deja
-- un plan del 31 en el 31: 31 ene, 28 feb, 31 mar.
create or replace function public.financing_schedule_due_date(
  p_start date, p_first_due date, p_freq text, p_k int
) returns date
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_first_due is null then financing_due_date(p_start, p_freq, p_k)
    else financing_due_date(p_first_due, p_freq, p_k - 1)
  end;
$function$;

revoke all on function public.sale_local_date(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.financing_schedule_due_date(date, date, text, int) from public, anon;
grant execute on function public.sale_local_date(uuid, timestamptz) to service_role;
grant execute on function public.financing_schedule_due_date(date, date, text, int) to authenticated, service_role;

-- Versión con el primer pago. `p_first_due` va sin default a propósito: con
-- default, una llamada de 7 argumentos sería ambigua entre esta y la vieja.
create or replace function public.build_financing_schedule(
  p_company_id uuid, p_sale_id uuid, p_start date, p_freq text,
  p_n int, p_installment numeric, p_debt numeric, p_first_due date
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
    values (p_company_id, p_sale_id, k,
            financing_schedule_due_date(p_start, p_first_due, p_freq, k), v_amount);
  end loop;
end;
$function$;

revoke all on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric, date) from public;
revoke all on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric, date) from anon, authenticated;
grant execute on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric, date) to service_role;

-- La de 7 argumentos se queda como atajo sin primer pago en vez de borrarla:
-- quien la llame (una migración vieja que se vuelva a correr, por ejemplo)
-- sigue armando el calendario de siempre en lugar de romper las ventas.
-- `create or replace` conserva sus permisos (solo service_role).
create or replace function public.build_financing_schedule(
  p_company_id uuid, p_sale_id uuid, p_start date, p_freq text,
  p_n int, p_installment numeric, p_debt numeric
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform build_financing_schedule(p_company_id, p_sale_id, p_start, p_freq,
                                   p_n, p_installment, p_debt, null::date);
end;
$function$;


-- ---------------------------------------------------------------------------
-- 2. La venta: valida el primer pago y arma el calendario desde él
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 3. Bitácora de cambios de fecha
-- ---------------------------------------------------------------------------

create table if not exists public.financing_schedule_changes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  sale_id         uuid not null references public.sales(id) on delete cascade,
  reason          text,
  -- [{ "installment": 1, "before": "2026-03-10", "after": "2026-03-30" }, ...]
  changes         jsonb not null,
  changed_by      uuid references public.profiles(id),
  changed_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists financing_schedule_changes_sale_idx
  on public.financing_schedule_changes (sale_id, created_at desc);
create index if not exists financing_schedule_changes_company_idx
  on public.financing_schedule_changes (company_id, created_at desc);

comment on table public.financing_schedule_changes is
  'Bitácora de cambios de fecha en las cuotas de un financiamiento: qué cuota, de qué fecha a cuál, quién y por qué. Solo la escribe reschedule_financing_installments.';

alter table public.financing_schedule_changes enable row level security;

-- Mismo criterio que `financing_amendments`: solo la lee quien puede hacer el
-- cambio, y solo la escribe la RPC, que es SECURITY DEFINER.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'financing_schedule_changes'
                    and policyname = 'financing_schedule_changes_select') then
    create policy financing_schedule_changes_select on public.financing_schedule_changes
      for select using (
        (company_id = current_company_id() and is_company_admin()) or is_super_admin()
      );
  end if;
end $$;

revoke all on table public.financing_schedule_changes from anon, authenticated;
grant select on table public.financing_schedule_changes to authenticated;


-- ---------------------------------------------------------------------------
-- 4. La RPC: reprogramar cuotas pendientes
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_financing_installments(
  p_sale_id uuid,
  p_installment_number int,
  p_new_date date,
  p_shift_following boolean default true,
  p_reason text default null
) returns jsonb
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

comment on function public.reschedule_financing_installments(uuid, int, date, boolean, text) is
  'Mueve la fecha de una cuota sin pagar de un financiamiento y, si se pide, recalcula las siguientes desde ahí con la frecuencia del plan. Las fechas tienen que quedar en orden y no antes de la venta. Deja rastro en financing_schedule_changes. Solo administradores.';

revoke all on function public.reschedule_financing_installments(uuid, int, date, boolean, text) from public, anon;
grant execute on function public.reschedule_financing_installments(uuid, int, date, boolean, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. Corregir el plan respeta el primer pago
-- ---------------------------------------------------------------------------

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

-- Las funciones de trigger las invoca Postgres, no la app: con EXECUTE para
-- `authenticated` quedarían expuestas por PostgREST. `create or replace`
-- conserva los permisos que ya tenían, pero esto lo deja explícito.
revoke all on function public.before_sale_credit_checks() from public, anon, authenticated;
revoke all on function public.after_sale_credit_effects() from public, anon, authenticated;
