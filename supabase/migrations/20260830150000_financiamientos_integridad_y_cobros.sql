-- Financiamientos: integridad del libro de abonos, zona horaria del negocio,
-- abono general que sí toca los financiamientos y anulación de abonos.
--
-- Cuatro cosas que estaban mal, en orden de gravedad:
--
-- 1. `register_customer_payment` (el abono desde Cuentas por Cobrar) repartía
--    FIFO solo sobre las ventas `credit` — nunca sobre las `in_financing` —
--    pero bajaba `customers.credit_balance` por el monto completo. Un cliente
--    que solo tiene financiamientos aparece igual en esa pantalla con su
--    balance y su botón de abonar: cobrarle por ahí le bajaba la deuda sin
--    tocar una sola cuota, y liberaba límite de crédito que nadie pagó. Ahora
--    las dos RPC comparten un solo motor (`apply_payment_to_sale`) y el
--    balance del cliente se RECALCULA desde sus ventas abiertas en vez de
--    sumarse y restarse a ciegas.
--
-- 2. El libro de abonos era editable desde el navegador: `credit_payments`,
--    `financing_installments`, `loan_payments` y `loan_installments` tenían
--    grant de UPDATE/DELETE/TRUNCATE a `authenticated`, y sus policies son
--    FOR ALL. RLS limita QUÉ FILAS ve cada quien, no QUÉ VERBOS: con la sesión
--    abierta, un PATCH a PostgREST marcaba una cuota como pagada. Aquí se
--    revocan esos permisos y las RPC de cobro pasan a SECURITY DEFINER con su
--    propio chequeo de empresa y sucursal (mismo criterio que `annul_sale`).
--
-- 3. Todo el cálculo de vencimientos corría en UTC y el país es UTC-4: entre
--    las 8:00 PM y medianoche hora RD la base ya estaba en el día siguiente, y
--    a quien llegaba a pagar el día del vencimiento se le cobraba mora. Se
--    agrega `companies.timezone` (default America/Santo_Domingo) y toda
--    comparación de fechas pasa por `company_today()`. De paso,
--    `companies.late_fee_grace_days` (default 0 = como hoy) para los días de
--    gracia antes de que la mora sea exigible.
--
-- 4. No había forma de revertir un abono mal digitado. Era el hueco que
--    obligaba a entrar a la base a mano — justo lo que el punto 2 cierra — así
--    que la operación legítima tiene que existir antes: `void_credit_payment`
--    anula por reverso (no borra), devuelve capital y mora a las cuotas
--    exactas que los recibieron, y saca el efectivo de la caja si hace falta.
--    Para poder revertir con precisión, cada abono guarda ahora en
--    `credit_payments.allocation` a qué venta y a qué cuota fue cada peso.


-- ── Configuración por empresa ───────────────────────────────────────────────

alter table public.companies
  add column if not exists timezone text not null default 'America/Santo_Domingo',
  add column if not exists late_fee_grace_days int not null default 0;

comment on column public.companies.timezone is
  'Zona horaria del negocio. Manda para decidir qué día es hoy al vencer cuotas y al generar planes de pago; la base corre en UTC.';
comment on column public.companies.late_fee_grace_days is
  'Días de gracia después del vencimiento antes de que la mora sea exigible. 0 = la mora aplica al día siguiente.';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_late_fee_grace_days_check') then
    alter table public.companies
      add constraint companies_late_fee_grace_days_check
      check (late_fee_grace_days between 0 and 60);
  end if;
end
$do$;


-- ── El libro de abonos: trazabilidad y anulación ────────────────────────────

alter table public.credit_payments
  add column if not exists kind text not null default 'sale',
  add column if not exists allocation jsonb,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists voided_by_name text,
  add column if not exists void_reason text;

comment on column public.credit_payments.kind is
  'down_payment = abono inicial de la venta (parte de la venta, no se anula suelto); sale = abono a una venta; customer = abono general del cliente repartido entre sus ventas.';
comment on column public.credit_payments.allocation is
  'A qué venta y a qué cuota fue cada peso. Lo escribe la RPC de cobro y lo lee la de anulación.';
comment on column public.credit_payments.voided_at is
  'Los abonos no se borran: se anulan por reverso. Todo lo que lea abonos debe filtrar voided_at is null.';

-- Los abonos que ya existen: el inicial se reconoce por la nota que le pone el
-- trigger de la venta, y el general porque no apunta a ninguna venta.
update public.credit_payments
   set kind = case
                when sale_id is null         then 'customer'
                when notes = 'Abono inicial' then 'down_payment'
                else 'sale'
              end
 where kind = 'sale';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'credit_payments_kind_check') then
    alter table public.credit_payments
      add constraint credit_payments_kind_check
      check (kind in ('down_payment', 'sale', 'customer'));
  end if;
end
$do$;

create index if not exists credit_payments_company_date_idx
  on public.credit_payments (company_id, date desc)
  where voided_at is null;


-- ── Qué día es hoy para esta empresa ────────────────────────────────────────

create or replace function public.company_today(p_company_id uuid)
returns date
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (now() at time zone coalesce(
           (select nullif(btrim(timezone), '') from companies where id = p_company_id),
           'America/Santo_Domingo'))::date;
$function$;

comment on function public.company_today(uuid) is
  'La fecha de hoy en la zona del negocio. La base corre en UTC: usar current_date adelantaba el día a partir de las 8:00 PM en RD.';

revoke all on function public.company_today(uuid) from public;
grant execute on function public.company_today(uuid) to authenticated, service_role;


-- ── El motor: aplicar un monto a UNA venta ──────────────────────────────────
--
-- Interno: no valida permisos, los valida quien lo llama. Cobra primero la
-- mora de las cuotas vencidas (pasada la gracia), luego capital FIFO, y sube
-- `sales.amount_paid` solo con el capital. Devuelve el detalle de la
-- aplicación para que el abono pueda revertirse cuota por cuota.

create or replace function public.apply_payment_to_sale(
  p_sale_id   uuid,
  p_amount    numeric,
  p_late_rate numeric,
  p_today     date,
  p_grace     int
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_is_fin    boolean;
  v_total_due numeric;
  v_remaining numeric := p_amount;
  v_late      numeric := 0;
  v_capital   numeric := 0;
  v_inst      record;
  v_apply     numeric;
  v_fee_due   numeric;
  v_insts     jsonb := '[]'::jsonb;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada.';
  end if;

  v_is_fin := (v_sale.payment_status = 'in_financing');

  if v_is_fin then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
  end if;
  v_total_due := greatest(round(v_total_due, 2), 0);

  if v_is_fin then
    perform 1 from financing_installments where sale_id = p_sale_id for update;

    -- 1) La mora primero: cargo único por cuota vencida, y solo pasada la gracia.
    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id
         and status <> 'paid'
         and due_date + p_grace < p_today
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_fee_due := greatest(round(v_inst.amount * p_late_rate / 100, 2) - v_inst.late_fee_paid, 0);
      if v_fee_due > 0 then
        v_apply := least(v_remaining, v_fee_due);
        update financing_installments
           set late_fee_paid = late_fee_paid + v_apply
         where id = v_inst.id;
        v_late      := v_late + v_apply;
        v_remaining := v_remaining - v_apply;
        v_insts := v_insts || jsonb_build_object(
          'id', v_inst.id, 'number', v_inst.installment_number,
          'principal', 0, 'late_fee', v_apply);
      end if;
    end loop;

    -- 2) Capital FIFO, sin pasarse de la deuda: lo que sobre se devuelve a
    --    quien llamó (el abono general lo lleva a la siguiente venta).
    v_remaining := least(v_remaining, v_total_due);
    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id and status <> 'paid'
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_remaining, v_inst.amount - v_inst.paid_amount);
      if v_apply > 0 then
        update financing_installments
           set paid_amount = paid_amount + v_apply,
               status  = case when paid_amount + v_apply >= amount - 0.005 then 'paid' else 'partial' end,
               paid_at = case when paid_amount + v_apply >= amount - 0.005 then now() else paid_at end
         where id = v_inst.id;
        v_remaining := v_remaining - v_apply;
        v_capital   := v_capital + v_apply;
        v_insts := v_insts || jsonb_build_object(
          'id', v_inst.id, 'number', v_inst.installment_number,
          'principal', v_apply, 'late_fee', 0);
      end if;
    end loop;
  else
    -- Crédito simple: no hay plan de cuotas ni mora, solo saldo.
    v_capital := least(v_remaining, v_total_due);
  end if;

  if v_capital > 0 then
    update sales
       set amount_paid = amount_paid + v_capital,
           payment_status = case
             when v_is_fin
                  and amount_paid + v_capital >=
                      coalesce((financing_details->>'totalWithInterest')::numeric, total) - 0.01
               then 'paid'::payment_status
             when not v_is_fin and amount_paid + v_capital >= total - 0.01
               then 'paid'::payment_status
             else payment_status
           end
     where id = p_sale_id;
  end if;

  return jsonb_build_object(
    'sale_id',      p_sale_id,
    'principal',    round(v_capital, 2),
    'late_fee',     round(v_late, 2),
    'consumed',     round(v_capital + v_late, 2),
    'installments', v_insts
  );
end;
$function$;

comment on function public.apply_payment_to_sale(uuid, numeric, numeric, date, int) is
  'Interno: aplica un monto a una venta (mora primero, luego capital FIFO) y devuelve el detalle para poder revertirlo. No valida permisos — eso lo hace la RPC que lo llama.';

revoke all on function public.apply_payment_to_sale(uuid, numeric, numeric, date, int) from public;


-- ── Deuda real de un cliente: calculada, no acumulada ───────────────────────

create or replace function public.recompute_customer_balance(p_customer_id uuid)
returns numeric
language plpgsql
set search_path to 'public'
as $function$
declare
  v_balance numeric;
begin
  if p_customer_id is null then
    return null;
  end if;

  select coalesce(sum(
           case when payment_status = 'in_financing'
                then coalesce((financing_details->>'totalWithInterest')::numeric, total) - amount_paid
                else total - amount_paid end), 0)
    into v_balance
    from sales
   where customer_id = p_customer_id
     and payment_status in ('credit', 'in_financing')
     and cancelled_at is null;

  v_balance := greatest(round(v_balance, 2), 0);

  update customers set credit_balance = v_balance where id = p_customer_id;
  return v_balance;
end;
$function$;

comment on function public.recompute_customer_balance(uuid) is
  'Interno: recalcula customers.credit_balance desde las ventas abiertas del cliente. Sumar y restar a ciegas dejaba el balance a la deriva; esto lo vuelve derivado y se autocorrige.';

revoke all on function public.recompute_customer_balance(uuid) from public;


-- ── Quién puede cobrarle a esta venta ───────────────────────────────────────
--
-- Las RPC pasan a SECURITY DEFINER (para poder escribir en tablas donde el
-- usuario ya no tiene INSERT), así que el permiso hay que validarlo a mano.
-- Es el mismo predicado de la policy `sales_all`.

create or replace function public.can_collect_sale(p_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select is_super_admin() or exists (
    select 1 from sales s
     where s.id = p_sale_id
       and s.company_id = current_company_id()
       and (is_company_admin()
            or s.branch_id in (select user_branch_ids())
            or (s.payment_status = 'credit'
                and branch_shares_with_me('credito', s.branch_id))
            or (s.payment_status = 'in_financing'
                and branch_shares_with_me('financiamiento', s.branch_id)))
  );
$function$;

revoke all on function public.can_collect_sale(uuid) from public;
grant execute on function public.can_collect_sale(uuid) to authenticated, service_role;


-- ── RPC: abono a una venta a crédito o financiada ───────────────────────────

create or replace function public.register_sale_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale       sales%rowtype;
  v_late_rate  numeric;
  v_grace      int;
  v_today      date;
  v_total_due  numeric;
  v_late_due   numeric := 0;
  v_res        jsonb;
  v_payment_id uuid;
  v_user_name  text;
  v_paid_count int := 0;
  v_total_count int := 0;
  v_balance    numeric;
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
  -- ser de la misma empresa. Antes llegaba resuelta por NOMBRE desde el
  -- navegador y no se comprobaba.
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
    into v_late_rate, v_grace
    from companies where id = v_sale.company_id;
  v_late_rate := coalesce(v_late_rate, 5);
  v_grace     := coalesce(v_grace, 0);
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

comment on function public.register_sale_payment(uuid, numeric, text, uuid, text, text) is
  'Abono a una venta a crédito o financiada. Cobra la mora primero, luego capital FIFO a las cuotas. SECURITY DEFINER: valida empresa, sucursal y acceso a mano porque el libro de abonos ya no es escribible desde el navegador.';

revoke all on function public.register_sale_payment(uuid, numeric, text, uuid, text, text) from public;
grant execute on function public.register_sale_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;


-- ── RPC: abono general del cliente ──────────────────────────────────────────
--
-- El cambio de fondo: antes solo repartía entre ventas `credit` pero bajaba el
-- balance completo, así que a un cliente con financiamientos le borraba deuda
-- que nadie pagó. Ahora entra a TODAS sus ventas abiertas — crédito y
-- financiamiento — empezando por la de vencimiento más viejo, y dentro de cada
-- una cobra mora antes que capital. El balance no se resta: se recalcula.

create or replace function public.register_customer_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
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

  select coalesce(late_fee_rate, 5), coalesce(late_fee_grace_days, 0)
    into v_late_rate, v_grace
    from companies where id = v_customer.company_id;
  v_late_rate := coalesce(v_late_rate, 5);
  v_grace     := coalesce(v_grace, 0);
  v_today     := company_today(v_customer.company_id);

  -- El techo sale de las ventas, no de `credit_balance`: capital pendiente más
  -- la mora exigible de las cuotas ya vencidas.
  select coalesce(sum(deuda + mora), 0) into v_max
    from (
      select
        case when s.payment_status = 'in_financing'
             then coalesce((s.financing_details->>'totalWithInterest')::numeric, s.total) - s.amount_paid
             else s.total - s.amount_paid end as deuda,
        coalesce((select sum(greatest(round(fi.amount * v_late_rate / 100, 2) - fi.late_fee_paid, 0))
                    from financing_installments fi
                   where fi.sale_id = s.id and fi.status <> 'paid'
                     and fi.due_date + v_grace < v_today), 0) as mora
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
    v_res := apply_payment_to_sale(v_sale.id, v_remaining, v_late_rate, v_today, v_grace);
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

comment on function public.register_customer_payment(uuid, numeric, text, uuid, text, text) is
  'Abono a la deuda general del cliente. Se reparte entre TODAS sus ventas abiertas (crédito y financiamiento), de la más vencida a la más nueva, mora antes que capital.';

revoke all on function public.register_customer_payment(uuid, numeric, text, uuid, text, text) from public;
grant execute on function public.register_customer_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;


-- ── RPC: anular un abono ────────────────────────────────────────────────────
--
-- No borra: marca `voided_at` y devuelve por reverso capital y mora a las
-- cuotas exactas que los recibieron, usando la aplicación guardada. El abono
-- inicial no entra: es parte de la venta.

create or replace function public.void_credit_payment(
  p_payment_id uuid,
  p_reason text
) returns jsonb
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
                    case when financing_details is not null
                         then coalesce((financing_details->>'totalWithInterest')::numeric, total)
                         else total end - 0.01
                 then 'paid'::payment_status
               when financing_details is not null then 'in_financing'::payment_status
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

comment on function public.void_credit_payment(uuid, text) is
  'Anula un abono por reverso (no lo borra): devuelve capital y mora a las cuotas que los recibieron, recalcula el balance del cliente y saca el efectivo de la caja si el abono venía de una sesión ya cerrada. Solo administradores.';

revoke all on function public.void_credit_payment(uuid, text) from public;
grant execute on function public.void_credit_payment(uuid, text) to authenticated, service_role;


-- ── RPC de préstamos: mismo endurecimiento ──────────────────────────────────
--
-- Cuerpo igual al que ya estaba en producción; cambia que ahora es SECURITY
-- DEFINER con su chequeo de acceso (porque `loan_payments` deja de ser
-- escribible desde el navegador) y que las fechas salen de `company_today`.

create or replace function public.register_loan_payment(
  p_loan_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_loan          public.loans%rowtype;
  v_late_rate     numeric;
  v_grace         int;
  v_today         date;
  v_total_due     numeric;
  v_late_due      numeric := 0;
  v_late_collect  numeric := 0;
  v_capital       numeric;
  v_remaining     numeric;
  v_inst          record;
  v_apply         numeric;
  v_fee_due       numeric;
  v_payment_id    uuid;
  v_user_name     text;
  v_paid_count    int := 0;
  v_total_count   int := 0;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'Préstamo no encontrado.';
  end if;
  if not (is_super_admin() or (v_loan.company_id = current_company_id()
          and (is_company_admin()
               or v_loan.branch_id in (select user_branch_ids())
               or branch_shares_with_me('prestamos', v_loan.branch_id)))) then
    raise exception 'No tienes acceso a este préstamo.';
  end if;
  if v_loan.status = 'paid' then
    raise exception 'Este préstamo ya está saldado.';
  end if;

  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_loan.company_id;
    if not found then
      raise exception 'Sucursal no válida para este préstamo.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_loan.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  select coalesce(loan_late_fee_rate, 5), coalesce(late_fee_grace_days, 0)
    into v_late_rate, v_grace
    from public.companies where id = v_loan.company_id;
  v_late_rate := coalesce(v_late_rate, 5);
  v_grace     := coalesce(v_grace, 0);
  v_today     := company_today(v_loan.company_id);

  v_total_due := v_loan.total_with_interest - v_loan.amount_paid;

  perform 1 from public.loan_installments where loan_id = p_loan_id for update;

  select coalesce(sum(greatest(round(amount * v_late_rate / 100, 2) - late_fee_paid, 0)), 0)
    into v_late_due
    from public.loan_installments
   where loan_id = p_loan_id and status <> 'paid' and due_date + v_grace < v_today;

  if p_amount > v_total_due + v_late_due + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'), to_char(v_total_due + v_late_due, 'FM999,999,990.00');
  end if;

  v_remaining := p_amount;

  for v_inst in
    select * from public.loan_installments
     where loan_id = p_loan_id and status <> 'paid' and due_date + v_grace < v_today
     order by installment_number
  loop
    exit when v_remaining <= 0;
    v_fee_due := greatest(round(v_inst.amount * v_late_rate / 100, 2) - v_inst.late_fee_paid, 0);
    if v_fee_due > 0 then
      v_apply := least(v_remaining, v_fee_due);
      update public.loan_installments set late_fee_paid = late_fee_paid + v_apply where id = v_inst.id;
      v_late_collect := v_late_collect + v_apply;
      v_remaining := v_remaining - v_apply;
    end if;
  end loop;

  v_capital := v_remaining;

  for v_inst in
    select * from public.loan_installments
     where loan_id = p_loan_id and status <> 'paid'
     order by installment_number
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, v_inst.amount - v_inst.paid_amount);
    if v_apply > 0 then
      update public.loan_installments
         set paid_amount = paid_amount + v_apply,
             status  = case when paid_amount + v_apply >= amount then 'paid' else 'partial' end,
             paid_at = case when paid_amount + v_apply >= amount then now() else paid_at end
       where id = v_inst.id;
      v_remaining := v_remaining - v_apply;
    end if;
  end loop;

  select name into v_user_name from public.profiles where id = auth.uid();

  insert into public.loan_payments
    (company_id, loan_id, customer_id, branch_id, amount, late_fee_paid, method, reference, notes, user_id, user_name, date)
  values
    (v_loan.company_id, v_loan.id, v_loan.customer_id, p_branch_id, p_amount, v_late_collect,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now())
  returning id into v_payment_id;

  update public.loans
     set amount_paid = amount_paid + v_capital,
         status = case when amount_paid + v_capital >= total_with_interest - 0.01 then 'paid' else status end
   where id = p_loan_id;

  select count(*) filter (where status = 'paid'), count(*)
    into v_paid_count, v_total_count
    from public.loan_installments where loan_id = p_loan_id;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'amount', p_amount,
    'late_fee_paid', v_late_collect,
    'principal_paid', v_capital,
    'remaining_balance', greatest(v_total_due - v_capital, 0),
    'installments_paid', v_paid_count,
    'installments_total', v_total_count
  );
end;
$function$;

revoke all on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) from public;
grant execute on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;


-- ── El plan de cuotas nace en la fecha del negocio, no en UTC ───────────────

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
begin
  if new.payment_status not in ('credit','in_financing') then
    return new;
  end if;

  if new.payment_status = 'in_financing' then
    v_n     := (new.financing_details->>'installments')::int;
    v_cuota := (new.financing_details->>'installmentAmount')::numeric;
    v_debt  := (new.financing_details->>'totalWithInterest')::numeric - new.amount_paid;

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
      insert into financing_installments (company_id, sale_id, installment_number, due_date, amount)
      values (new.company_id, new.id, k, (v_start + make_interval(months => k))::date, v_amount);
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


-- ── El cierre de caja no cuenta abonos anulados ─────────────────────────────

create or replace function public.close_caja_session(
  p_session_id uuid,
  p_closing_amount_declared numeric,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company     uuid;
  v_user_name   text;
  v_s           caja_sessions%rowtype;
  v_cash_sales  numeric;
  v_credit_cash numeric;
  v_loan_cash   numeric;
  v_mov_in      numeric;
  v_mov_out     numeric;
  v_expected    numeric;
  v_diff        numeric;
  v_breakdown   jsonb;
begin
  if p_closing_amount_declared is null or p_closing_amount_declared < 0 then
    raise exception 'El monto declarado no puede ser negativo.';
  end if;

  v_company := current_company_id();

  select * into v_s from caja_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesión de caja no encontrada.';
  end if;
  if v_s.company_id <> v_company and not is_super_admin() then
    raise exception 'No tienes acceso a esta caja.';
  end if;
  if not (is_company_admin() or v_s.branch_id in (select user_branch_ids()) or is_super_admin()) then
    raise exception 'No tienes acceso a la caja de esta sucursal.';
  end if;
  if v_s.status <> 'open' then
    raise exception 'Esta caja ya fue cerrada.';
  end if;

  v_cash_sales := coalesce((select sum(total) from sales
                where branch_id = v_s.branch_id and payment_method = 'cash'
                  and created_at >= v_s.opened_at and created_at < now()), 0);
  -- Un abono anulado nunca se quedó en la gaveta: no puede cuadrar el cierre.
  v_credit_cash := coalesce((select sum(amount) from credit_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and voided_at is null
                  and date >= v_s.opened_at and date < now()), 0);
  v_loan_cash := coalesce((select sum(amount) from loan_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and date >= v_s.opened_at and date < now()), 0);
  v_mov_in := coalesce((select sum(amount) from caja_movements
                where session_id = v_s.id and type = 'in'), 0);
  v_mov_out := coalesce((select sum(amount) from caja_movements
                where session_id = v_s.id and type = 'out'), 0);

  v_expected := v_s.opening_amount + v_cash_sales + v_credit_cash + v_loan_cash + v_mov_in - v_mov_out;
  v_diff := p_closing_amount_declared - v_expected;

  v_breakdown := jsonb_build_object(
    'opening',            v_s.opening_amount,
    'cashSales',          v_cash_sales,
    'creditCashPayments', v_credit_cash,
    'loanCashPayments',   v_loan_cash,
    'movementsIn',        v_mov_in,
    'movementsOut',       v_mov_out,
    'expected',           v_expected,
    'declared',           p_closing_amount_declared,
    'difference',         v_diff
  );

  select name into v_user_name from profiles where id = auth.uid();

  update caja_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = auth.uid(),
         closed_by_name = v_user_name,
         closing_amount_declared = p_closing_amount_declared,
         closing_amount_expected = v_expected,
         difference = v_diff,
         breakdown = v_breakdown,
         notes = coalesce(p_notes, notes)
   where id = p_session_id;

  return jsonb_build_object(
    'session_id',        v_s.id,
    'opening_amount',    v_s.opening_amount,
    'expected',          v_expected,
    'declared',          p_closing_amount_declared,
    'difference',        v_diff
  );
end;
$function$;


-- ── El libro de abonos deja de ser escribible desde el navegador ────────────
--
-- RLS decide QUÉ FILAS ve cada quien; los grants deciden QUÉ VERBOS puede
-- usar. Con la sesión abierta y el anon key (que es público por diseño), un
-- PATCH a PostgREST marcaba una cuota como pagada o borraba un abono. Todo lo
-- que mueva dinero pasa ahora solo por las RPC de arriba, que son
-- SECURITY DEFINER y validan empresa, sucursal y rol.
--
-- Se deja INSERT en `sales`/`sale_items`/`loans` porque las ventas y los
-- préstamos siguen naciendo desde el cliente (`create_sale_with_items` es
-- SECURITY INVOKER y los triggers que cuelgan de ahí sí son DEFINER).

revoke insert, update, delete, truncate on public.credit_payments        from anon, authenticated;
revoke insert, update, delete, truncate on public.financing_installments from anon, authenticated;
revoke insert, update, delete, truncate on public.loan_payments          from anon, authenticated;
revoke insert, update, delete, truncate on public.loan_installments      from anon, authenticated;
revoke update, delete, truncate         on public.sales                  from anon, authenticated;
revoke update, delete, truncate         on public.loans                  from anon, authenticated;
